<script>
// Conversation mode: a dashboard of what is going on, and the chats that act on it.
//
// Two views on one path, `/dev/c/_/conversation` - the dashboard, and the chats with `?view=chat`
// and the chat as the hash. Never a path segment: see routes.ts. This page owns what both of them read: the chats,
// what each agent is doing, and which chat is about which pull request (links.ts). The chats view
// is mounted the first time it is shown and then kept, so its panes - and their sockets - live
// through a trip to the dashboard and back.
//
// Everything a conversation is (the registry, the pane, the transcript, the chat drawn from it) is
// the Dev product's own; config.mjs says how ours differ: the interrupt-duty repo as the working
// directory and conv-shell as the tunnel.
import AppIcon from '../components/focus/AppIcon.vue';
import ConversationChats from './ConversationChats.vue';
import ConversationDashboard from './ConversationDashboard.vue';
import ConversationBrowser from './ConversationBrowser.vue';
import { ensureOpeningSaid } from './opening';
import {
  listConversations, startConversation, renameConversation, endConversation, conversationStates,
  conversationSnapshot, statesFromSnapshot, sendToPane
} from '../conversations';
import { agentStateOf } from '../workspace-status';
import {
  DEV_PRODUCT, BLANK_CLUSTER, WORKSPACES_ROUTE, FOCUS_ROUTE
} from '../config/constants';
import { CONVERSATION_ROUTE } from './routes';
import { CONVERSATION_WORKSPACE, nextChatTitle } from './config.mjs';
import {
  PROJECTS, mergeWork, subjectKey, shortRef, chatTitleFor, openingMessage, pickupMessage, reviewStartMessage, attentionRows
} from './projects.mjs';
import {
  extractUrls, githubRef, titleFromMessage, isDefaultTitle, chatLinks
} from './linkify.mjs';
import { readLinks, updateLinks } from './links';
import { readTranscripts } from './transcripts';
import { readMarks } from './marks';
import { emptyMarks, withQuestionStamps, quietKeys } from './nothing-to-do.mjs';
import { lastUpdated, byLastUpdated } from './rail.mjs';
import { myWork, pullRequest, issuesByNumber } from '../github';
import { fetchWork, requestRefresh, listenForWork } from './work-client';

/** How often what each agent is doing is asked again. */
const STATE_POLL_MS = 5000;

/** The states dev-api decides that the page takes as they are (conversations.ts, ConversationNow). */
const DECIDED_STATES = new Set(['working', 'input', 'idle', 'finished']);

/** How often the transcripts are read: the links bar and the chats' names come from them. */
const TRANSCRIPT_POLL_MS = 20000;

/** How long a closed chat's terminal gets to let go of its pane before the conversation is ended. */
const CLOSE_SETTLE_MS = 1500;

/** How often the "Nothing to do" marks are read again, for one made in another browser or by an agent. */
const MARKS_POLL_MS = 60000;

/** ...and how often while a chat is working, so what it is doing (the dashboard says) keeps up. */
const TRANSCRIPT_BUSY_MS = 8000;

/** GitHub in the background, whichever view is showing. */
const WORK_REFRESH_MS = 10 * 60 * 1000;

/** After a chat finishes a turn, GitHub again - but not more often than this. */
const WORK_AFTER_TURN_MS = 2 * 60 * 1000;

/** And a moment after the turn, so a push or a comment it made has landed. */
const WORK_AFTER_TURN_DELAY_MS = 15000;

/** The last answer, kept in this browser so the dashboard draws at once on the next visit. */
const WORK_CACHE_KEY = 'conversation-mode.work.v1';
/** The chat last open in this browser: the Chats view opens on it rather than on the first chat. */
const LAST_CHAT_KEY = 'conversation-last-chat';

/** What is asked of GitHub per product, one query each: see loadWork(). */
const SECTIONS = [
  { label: 'pull requests', sections: ['mine'] },
  { label: 'reviews', sections: ['reviewing'] },
  { label: 'issues', sections: ['issues'] },
];

/** GitHub queries in flight at once. */
const CONCURRENCY = 3;

const EMPTY_WORK = () => ({
  login: '', mine: [], reviewing: [], issues: []
});

export default {
  name: 'ConversationMode',

  components: {
    AppIcon, ConversationChats, ConversationDashboard, ConversationBrowser
  },

  data() {
    return {
      chats:        [],
      /** chat id -> when this page made it (ms): a new chat leads the lists before it has a transcript. */
      made:         {},
      activity:     {},
      links:        {},
      loadingChats: true,
      creating:     false,
      /** The subject a chat is being started for, so its button says so. */
      starting:     '',
      error:        '',
      /** Whether the chats view has been shown yet: it is mounted then and kept. */
      chatsShown:   false,
      /** GitHub, as myWork() answers it - owned here so it outlives a switch of view. */
      work:         EMPTY_WORK(),
      workErrors:   [],
      workLoading:  false,
      workLoadedAt: 0,
      /** What each chat's transcript says (transcripts.ts): its first message, its links, what it is doing. */
      transcripts:  {},
      transcriptsAt: 0,
      /** "Nothing to do" (nothing-to-do.mjs, marks.ts): the dashboard marks, the rail sets aside. */
      marks:        emptyMarks(),
      /** Chats this page has already tried to name, so a failed rename is not retried every poll. */
      titled:       {},
      /**
       * Where GitHub comes from: `server` (conversation-api asks and pushes; the page listens) or
       * `browser` (the page asks itself, every ten minutes) when the server cannot be reached.
       */
      workSource:   '',
      /** The software project cards' data, from conversation-api (none when the page asks GitHub itself). */
      projects:     [],
      /** Whether the browser has been shown: it is mounted then and kept, filters and all. */
      browserShown: false,
    };
  },

  async mounted() {
    this.loadCachedWork();
    await Promise.all([this.loadChats(), this.loadLinks()]);
    this.poll = setInterval(() => this.refreshStates(), STATE_POLL_MS);
    this.transcriptPoll = setInterval(() => this.pollTranscripts(), TRANSCRIPT_BUSY_MS);
    this.loadMarks();
    this.marksPoll = setInterval(() => this.loadMarks(), MARKS_POLL_MS);
    this.refreshStates();
    this.refreshTranscripts();
    this.startWork();
  },

  beforeUnmount() {
    clearInterval(this.poll);
    clearInterval(this.transcriptPoll);
    clearInterval(this.marksPoll);
    clearInterval(this.workPoll);
    clearTimeout(this.workSoon);
    this.workListener?.close();
  },

  computed: {
    view() {
      return ['chat', 'browser'].includes(this.$route.query.view) ? this.$route.query.view : 'dashboard';
    },

    current() {
      const id = (this.$route.hash || '').replace(/^#/, '');

      return this.chats.some((c) => c.id === id) ? id : '';
    },

    devTo() {
      return { name: WORKSPACES_ROUTE, params: { product: DEV_PRODUCT, cluster: BLANK_CLUSTER } };
    },

    focusTo() {
      return { name: FOCUS_ROUTE, params: { product: DEV_PRODUCT, cluster: BLANK_CLUSTER } };
    },

    principal() {
      return this.$store.getters['rancher/byId']('principal', this.$store.getters['auth/principalId']) || {};
    },

    /** The first name, the way the mockup greets: "Good evening, Marcelo". */
    firstName() {
      const name = this.principal.name || this.principal.loginName || '';

      return name.split(/\s+/)[0] || '';
    },

    waiting() {
      return this.chats.filter((c) => this.activity[c.id] === 'input').length;
    },

    /** Each chat's links, as the links bar shows them (linkify.mjs). */
    /** chat id -> when it last moved (rail.mjs, lastUpdated): both views list the chats newest first. */
    /** chat id -> the last message a person sent it ({ text, at }), from its transcript: the Chats view shows it on top. */
    lastSaid() {
      return Object.fromEntries(this.chats.map((c) => [c.id, this.transcripts[c.id]?.said || null]));
    },

    lastAt() {
      return lastUpdated(this.chats, this.transcripts, this.made);
    },

    /** The keys of the rows marked "Nothing to do" that still hold; their rail items go aside. */
    quietKeys() {
      return quietKeys(withQuestionStamps(attentionRows(this.work, this.chats, this.activity, this.links), this.transcripts), this.marks);
    },

    chatLinksById() {
      const out = {};

      for (const chat of this.chats) {
        const linked = this.links[chat.id] || {};

        out[chat.id] = chatLinks({ subject: linked.subject, saved: linked.links || [], urls: this.transcripts[chat.id]?.urls || [] });
      }

      return out;
    },
  },

  watch: {
    view: {
      immediate: true,
      handler(v) {
        if (v === 'browser') {
          this.browserShown = true;
        }
        if (v === 'chat') {
          this.chatsShown = true;
          if (!this.current && this.chats.length) {
            this.go('chat', this.openingChat(this.chats), true);
          }
        }
      },
    },

    chats(list) {
      if (this.view === 'chat' && !this.current && list.length) {
        this.go('chat', this.openingChat(list), true);
      }
    },

    /** Remembered, so the next visit to Chats opens here. */
    current(id) {
      if (id) {
        try {
          window.localStorage.setItem(LAST_CHAT_KEY, id);
        } catch {
          // A private window or blocked storage: Chats opens on the chat that moved last instead.
        }
      }
    },
  },

  methods: {
    /** To a view (and a chat), keeping the route the single place both live. */
    go(view, id = '', replace = false) {
      const to = {
        name:   CONVERSATION_ROUTE,
        params: { product: DEV_PRODUCT, cluster: BLANK_CLUSTER },
        query:  view === 'dashboard' ? {} : { view },
        hash:   id ? `#${ id }` : '',
      };

      (replace ? this.$router.replace(to) : this.$router.push(to)).catch(() => {});
    },

    async loadChats() {
      this.loadingChats = true;
      try {
        let list = await listConversations(CONVERSATION_WORKSPACE);
        const wanted = (this.$route.hash || '').replace(/^#/, '');

        // A link to a chat made a moment ago can arrive before the registry lists it: ask once more.
        if (wanted && !list.some((c) => c.id === wanted)) {
          await new Promise((done) => setTimeout(done, 1500));
          list = await listConversations(CONVERSATION_WORKSPACE);
        }
        this.chats = list.map((c) => ({ id: c.id, title: c.title, cli: c.cli || '' }));
      } catch (e) {
        this.error = `The chats could not be listed: ${ e?.message || e }`;
      } finally {
        this.loadingChats = false;
      }
    },

    async loadLinks() {
      try {
        this.links = await readLinks();
      } catch (e) {
        this.error = e?.message || String(e);
      }
    },

    async refreshStates() {
      /*
       * dev-api's watcher decides each state and says so (`state`); that is the answer. Worked out
       * again from the hook event here it was wrong: the snapshot drops the notification's type
       * (`note` is null), and a bare `Notification` reads as a question - so every chat resting
       * at its prompt after a turn ("idle_prompt") showed as waiting for you. agentStateOf is
       * only for when the watcher cannot be reached and conversationStates() reads the pod.
       */
      const snapshot = await conversationSnapshot().catch(() => null);
      const decided = {};

      for (const c of Object.values(snapshot?.conversations || {})) {
        if (c?.id && DECIDED_STATES.has(c.state)) {
          decided[c.id] = c.state;
        }
      }
      const states = snapshot ? statesFromSnapshot(snapshot) : await conversationStates().catch(() => null);

      if (!states) {
        return;
      }
      const activity = {};

      for (const s of states) {
        if (s.workspace === CONVERSATION_WORKSPACE) {
          activity[s.id] = decided[s.id] || agentStateOf(s);
        }
      }
      // A chat that was working and stopped has probably done something on GitHub - pushed,
      // commented, opened a pull request - so the dashboard asks again, soon and not too often.
      const finished = Object.keys(this.activity).some((id) => this.activity[id] === 'working' && activity[id] && activity[id] !== 'working');

      this.activity = activity;
      if (finished) {
        this.workAfterTurn();
        this.refreshTranscripts();
      }
    },

    /* ── GitHub ─────────────────────────────────────────────────────────────────────────────── */

    /**
     * The server when it is there: its answer now, then every answer it pushes. The page asking
     * GitHub itself, every ten minutes, when it is not - a fresh mf-dev without conversation-api,
     * or one where it is down - so the dashboard is never left empty for want of it.
     */
    async startWork() {
      const first = await fetchWork();

      if (first) {
        this.workSource = 'server';
        this.applyWork(first);
        this.workListener = listenForWork((m) => this.applyWork(m));

        return;
      }
      this.workSource = 'browser';
      this.workPoll = setInterval(() => this.loadWork(), WORK_REFRESH_MS);
      if (Date.now() - this.workLoadedAt > WORK_REFRESH_MS) {
        this.loadWork();
      }
    },

    /** One answer from the server: `{ at, work, errors, refreshing }`. */
    applyWork(m) {
      if (m?.at) {
        this.work = { ...EMPTY_WORK(), ...m.work };
        this.workErrors = m.errors || [];
        this.workLoadedAt = m.at;
        this.projects = m.projects || this.projects;
        this.saveCachedWork();
      }
      this.workLoading = !!m?.refreshing;
    },

    /** A refresh, asked of whichever is answering: the server (which may say it is too soon) or GitHub. */
    async refreshWork(reason = 'refresh button') {
      if (this.workSource !== 'server') {
        return this.loadWork();
      }
      const answer = await requestRefresh(reason);

      if (!answer) {
        // The server went away: this page asks GitHub itself until it is reloaded.
        this.workListener?.close();
        this.workSource = 'browser';
        this.workPoll = setInterval(() => this.loadWork(), WORK_REFRESH_MS);

        return this.loadWork();
      }
      if (answer.started) {
        this.workLoading = true;
      }
    },

    saveCachedWork() {
      try {
        // Without the bodies: a pull request's description is most of its size and nothing here
        // draws it.
        const slim = (list) => (list || []).map(({ body, ...rest }) => rest);

        window.localStorage.setItem(WORK_CACHE_KEY, JSON.stringify({
          at: this.workLoadedAt, projects: this.projects, work: { ...this.work, mine: slim(this.work.mine), reviewing: slim(this.work.reviewing), issues: slim(this.work.issues) }
        }));
      } catch {
        // Storage full or blocked: the next visit loads it again.
      }
    },

    loadCachedWork() {
      try {
        const cached = JSON.parse(window.localStorage.getItem(WORK_CACHE_KEY) || 'null');

        if (cached?.work && cached.at) {
          this.work = { ...EMPTY_WORK(), ...cached.work };
          this.workLoadedAt = cached.at;
          this.projects = cached.projects || [];
        }
      } catch {
        // A private window or blocked storage: the first load draws it instead.
      }
    },

    /**
     * GitHub, one question per product and per section, three at a time.
     *
     * myWork() with every section is one GraphQL query of four searches, and GitHub gives a query
     * ten seconds: Rancher's and Harvester's answered 502/504 after 10-11s that way, while each
     * section on its own answers in one to three. A 502/503/504 is asked once more before it is
     * shown. What fails keeps nothing back: what answered is shown, and the errors say what is
     * missing.
     */
    async loadWork() {
      if (this.workLoading) {
        return;
      }
      this.workLoading = true;
      clearTimeout(this.workSoon);
      const jobs = PROJECTS.flatMap((p) => SECTIONS.map((sec) => ({ p, sec })));
      const settled = new Array(jobs.length);
      let next = 0;
      const ask = async({ p, sec }) => {
        try {
          return await myWork(p.repos, [], sec.sections);
        } catch (e) {
          if (!/ 50[234]\b/.test(e?.message || '')) {
            throw e;
          }
          await new Promise((done) => setTimeout(done, 1500));

          return myWork(p.repos, [], sec.sections);
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, async() => {
        while (next < jobs.length) {
          const at = next++;

          settled[at] = await ask(jobs[at]).then((value) => ({ value }), (reason) => ({ reason }));
        }
      }));
      this.workErrors = settled
        .map((r, i) => (r.reason ? `${ jobs[i].p.name } ${ jobs[i].sec.label }: ${ r.reason?.message || r.reason }` : ''))
        .filter(Boolean);
      const answers = settled.map((r) => r.value || null);

      if (answers.some(Boolean)) {
        this.work = mergeWork(answers);
        this.workLoadedAt = Date.now();
        this.saveCachedWork();
      }
      this.workLoading = false;
    },

    workAfterTurn() {
      if (Date.now() - this.workLoadedAt < WORK_AFTER_TURN_MS || this.workSoon) {
        return;
      }
      this.workSoon = setTimeout(() => {
        this.workSoon = null;
        this.refreshWork('a chat finished a turn');
      }, WORK_AFTER_TURN_DELAY_MS);
    },

    /* ── Transcripts: links and names ─────────────────────────────────────────────────────── */

    async loadMarks() {
      try {
        this.marks = await readMarks();
      } catch {
        // Not readable now (a restart, a blip): everything shows as it would unmarked.
      }
    },

    /** Every poll while a chat is working; otherwise every TRANSCRIPT_POLL_MS. */
    pollTranscripts() {
      const busy = Object.values(this.activity).some((state) => state === 'working');

      if (busy || Date.now() - this.transcriptsAt >= TRANSCRIPT_POLL_MS - TRANSCRIPT_BUSY_MS / 2) {
        this.refreshTranscripts();
      }
    },

    async refreshTranscripts() {
      if (!this.chats.length || this.readingTranscripts) {
        return;
      }
      this.readingTranscripts = true;
      try {
        this.transcripts = await readTranscripts(this.chats.map((c) => c.id));
        this.transcriptsAt = Date.now();
        await this.nameChats();
      } catch {
        // The agent pod is restarting, or an exec was cut short: the next poll reads them again.
      } finally {
        this.readingTranscripts = false;
      }
    },

    /**
     * A chat still called "Chat 3" takes its name from its first message, once: the pull request or
     * issue it names (then it is linked to it too, so the dashboard opens it from that row), or the
     * first thing it says. A chat somebody renamed is never touched.
     */
    async nameChats() {
      for (const chat of this.chats) {
        const first = this.transcripts[chat.id]?.first || '';

        if (!first || !isDefaultTitle(chat.title) || this.titled[chat.id]) {
          continue;
        }
        this.titled = { ...this.titled, [chat.id]: true };
        const ref = extractUrls(first).map(githubRef).find(Boolean);
        let title = '';

        if (ref) {
          let refTitle = '';

          try {
            refTitle = ref.kind === 'pr' ? (await pullRequest(ref.repo, ref.number)).title : ((await issuesByNumber(ref.repo, [ref.number]))[0]?.title || '');
          } catch {
            refTitle = '';
          }
          const subject = { ...ref, title: refTitle };

          title = chatTitleFor(subject);
          if (!this.links[chat.id]?.subject) {
            this.links = await updateLinks((links) => {
              links[chat.id] = { ...(links[chat.id] || {}), subject };
            }).catch(() => this.links);
          }
        } else {
          title = titleFromMessage(first);
        }
        if (title) {
          await this.renameChat({ id: chat.id, title });
        }
      }
    },

    /**
     * A new chat, optionally about a subject: named for it, opened with its link as the first
     * message (queued, and read by claude when the pane starts - which is the moment the chats
     * view shows it), and recorded in the links so the dashboard finds it again.
     *
     * `quiet`: nothing queued (another chat on the same subject). `opening: 'pickup'`: Find work's
     * first message (pickupMessage) instead of the usual where-it-stands one.
     */
    async createChat(subject = null, { quiet = false, opening = '' } = {}) {
      if (this.creating) {
        return;
      }
      this.creating = true;
      this.starting = subject ? subjectKey(subject.repo, subject.number) : '';
      this.error = '';
      try {
        // Another chat on a subject that has one already ("New chat on dashboard#19830") is named for
        // its place among them and opens with nothing queued: it is for a question of its own.
        const others = subject ? this.chats.filter((c) => {
          const s = this.links[c.id]?.subject;

          return s && subjectKey(s.repo, s.number) === subjectKey(subject.repo, subject.number);
        }).length : 0;
        const title = !subject ? nextChatTitle(this.chats.map((c) => c.title)) : quiet && others ? `${ shortRef(subject.repo, subject.number) } chat ${ others + 1 }` : chatTitleFor(subject);
        // Nothing for a chat about nothing, or another one on the same subject.
        const first = !subject || quiet ? '' : this.openingFor(subject, opening);
        const made = await startConversation(CONVERSATION_WORKSPACE, title, first);

        this.chats = [...this.chats, { id: made.id, title: made.title || title, cli: '' }];
        this.made = { ...this.made, [made.id]: Date.now() };
        if (subject) {
          this.links = await updateLinks((links) => {
            links[made.id] = { ...(links[made.id] || {}), subject };
          }).catch((e) => {
            this.error = `The chat started, but its link to ${ subject.url } was not saved: ${ e?.message || e }`;

            return { ...this.links, [made.id]: { subject } };
          });
        }
        this.go('chat', made.id);
        if (first) {
          this.sayOpening(made.id, first);
        }
      } catch (e) {
        this.error = `A new chat could not be started: ${ e?.message || e }`;
      } finally {
        this.creating = false;
        this.starting = '';
      }
    },

    /**
     * What a new chat on a subject opens with: Find work's doable-or-not check for an issue picked
     * there, a whole review (with which run it is) for a pull request you review, and otherwise
     * where it stands.
     */
    openingFor(subject, opening = '') {
      if (opening === 'pickup') {
        return pickupMessage(subject);
      }
      const key = subjectKey(subject.repo, subject.number);
      const reviewing = (this.work.reviewing || []).find((p) => subjectKey(p.repo, p.number) === key);

      if (subject.kind === 'pr' && (subject.role === 'reviewer' || (!subject.role && reviewing))) {
        return reviewStartMessage(subject, reviewing?.rounds);
      }

      return openingMessage(subject);
    },

    /**
     * A new chat's first message, typed in if its pane started without reading the queue
     * (opening.ts). In the background: the chat is already open and usable while this looks.
     */
    async sayOpening(id, text) {
      try {
        await ensureOpeningSaid(id, text);
      } catch (e) {
        this.error = `The chat's first message may not have reached it - check the chat and send it again if not: ${ e?.message || e }`;
      }
    },

    /** A prompt from the chat header's Work on it / Review it, typed into the chat's pane as the composer would. */
    async sendPrompt({ id, text }) {
      this.error = '';
      try {
        await sendToPane(id, text);
      } catch (e) {
        this.error = `The prompt could not be sent to the chat: ${ e?.message || e }`;
      }
    },

    /**
     * The chat Chats opens on when none is asked for: the one last open in this browser, if it is
     * still there; else the one that moved last; else the first.
     */
    openingChat(list) {
      let last = '';

      try {
        last = window.localStorage.getItem(LAST_CHAT_KEY) || '';
      } catch {
        last = '';
      }
      if (last && list.some((c) => c.id === last)) {
        return last;
      }

      return (byLastUpdated(list, this.lastAt)[0] || list[0]).id;
    },

    openChat(id) {
      this.go('chat', id);
    },

    /**
     * Archive chats, or bring them back: marked in the links, so they leave the dashboard's lists and
     * the rail files them under Done. The chats themselves stay, transcript and all - ending one is
     * the tab's ×. `cleared` is what Clear wrote before this, and goes with an unarchive.
     */
    async archiveChats({ ids = [], archived = true } = {}) {
      this.links = await updateLinks((links) => {
        for (const id of ids) {
          const { cleared, ...rest } = links[id] || {};

          links[id] = { ...rest, archived };
        }
      }).catch((e) => {
        this.error = `The chat could not be ${ archived ? 'archived' : 'brought back' }: ${ e?.message || e }`;

        return this.links;
      });
    },

    async renameChat({ id, title }) {
      const chat = this.chats.find((c) => c.id === id);

      if (!chat || title === chat.title) {
        return;
      }
      const before = chat.title;

      chat.title = title;
      try {
        await renameConversation(CONVERSATION_WORKSPACE, id, title);
      } catch (e) {
        chat.title = before;
        this.error = `The chat could not be renamed: ${ e?.message || e }`;
      }
    },

    /**
     * Close a chat: its pane first, then the conversation. Ended while its terminal was still
     * mounted, the terminal saw its session die, reconnected, and shell.sh started a new one - a
     * pane left running under a chat that was gone, which then came back with the chat number
     * (mf-dev, chats 45 and 46 on 2026-11-24). So the tab goes, the page moves off it and the
     * terminal is let go before the end; a failed end puts the tab back.
     */
    async closeChat(id) {
      this.error = '';
      const at = this.chats.findIndex((c) => c.id === id);
      const chat = this.chats[at];

      this.chats = this.chats.filter((c) => c.id !== id);
      if (this.current === id) {
        const next = this.chats[Math.min(at, this.chats.length - 1)];

        this.go('chat', next ? next.id : '', true);
      }
      await this.$nextTick();
      await new Promise((done) => setTimeout(done, CLOSE_SETTLE_MS));
      try {
        await endConversation(CONVERSATION_WORKSPACE, id);
        if (this.links[id]) {
          this.links = await updateLinks((links) => {
            delete links[id];
          }).catch(() => this.links);
        }
      } catch (e) {
        if (chat && !this.chats.some((c) => c.id === id)) {
          this.chats = [...this.chats.slice(0, at), chat, ...this.chats.slice(at)];
        }
        this.error = `The chat could not be closed: ${ e?.message || e }`;
      }
    },

    toRancher() {
      window.location.href = '/dashboard/home';
    },
  },
};
</script>

<template>
  <div
    class="conv"
    data-testid="conversation-mode"
  >
    <header class="conv__top">
      <div class="conv__brand">
        <span class="conv__mark"><AppIcon
          name="comment"
          :size="16"
        /></span>
        <span class="conv__name">Conversation</span>
      </div>
      <nav
        class="conv__views"
        aria-label="Views"
      >
        <button
          type="button"
          class="conv__view"
          :class="{ 'conv__view--on': view === 'dashboard' }"
          :aria-current="view === 'dashboard' ? 'page' : null"
          data-testid="conversation-view-dashboard"
          @click="go('dashboard')"
        >
          Dashboard
        </button>
        <button
          type="button"
          class="conv__view"
          :class="{ 'conv__view--on': view === 'browser' }"
          :aria-current="view === 'browser' ? 'page' : null"
          data-testid="conversation-view-browser"
          @click="go('browser')"
        >
          Browser
        </button>
        <button
          type="button"
          class="conv__view"
          :class="{ 'conv__view--on': view === 'chat' }"
          :aria-current="view === 'chat' ? 'page' : null"
          data-testid="conversation-view-chat"
          @click="go('chat', current)"
        >
          Chats
          <span class="conv__count">{{ chats.length }}</span>
          <span
            v-if="waiting"
            class="conv__count conv__count--warn"
            :title="`${ waiting } waiting for you`"
          >{{ waiting }}</span>
        </button>
      </nav>
      <div class="conv__spacer" />
      <nav
        class="conv__modes"
        aria-label="Modes"
      >
        <router-link
          :to="devTo"
          class="conv__mode"
        >
          Dev
        </router-link>
        <router-link
          :to="focusTo"
          class="conv__mode"
        >
          Focus
        </router-link>
      </nav>
      <button
        type="button"
        class="conv__back"
        data-testid="conversation-back-to-rancher"
        @click="toRancher"
      >
        <i class="icon icon-chevron-left" /> Back to Rancher
      </button>
    </header>

    <p
      v-if="error"
      class="conv__error"
      role="alert"
    >
      {{ error }}
      <button
        type="button"
        class="conv__error-close"
        aria-label="Dismiss"
        @click="error = ''"
      >
        <i class="icon icon-close" />
      </button>
    </p>

    <ConversationDashboard
      v-show="view === 'dashboard'"
      :chats="chats"
      :activity="activity"
      :links="links"
      :transcripts="transcripts"
      :last-at="lastAt"
      :marks="marks"
      :name="firstName"
      :starting="starting"
      :work="work"
      :errors="workErrors"
      :loading="workLoading"
      :loaded-at="workLoadedAt"
      :projects="projects"
      @open-chat="openChat"
      @start-chat="createChat"
      @new-chat="createChat()"
      @reload="refreshWork('refresh button')"
      @archive="archiveChats"
      @marks="(doc) => marks = doc"
      @view-chats="go('chat', current)"
    />
    <ConversationBrowser
      v-if="browserShown"
      v-show="view === 'browser'"
      :work="work"
      :chats="chats"
      :links="links"
      :activity="activity"
      :starting="starting"
      :loaded-at="workLoadedAt"
      @open-chat="openChat"
      @start-chat="createChat"
    />
    <ConversationChats
      v-if="chatsShown"
      v-show="view === 'chat'"
      :chats="chats"
      :activity="activity"
      :links="links"
      :chat-links="chatLinksById"
      :quiet-keys="quietKeys"
      :last-at="lastAt"
      :last-said="lastSaid"
      :work="work"
      :current="current"
      :loading="loadingChats"
      :creating="creating"
      @select="(id) => go('chat', id, true)"
      @create="(p) => createChat(p?.subject || null, { quiet: !!p?.quiet })"
      @rename="renameChat"
      @close="closeChat"
      @archive="archiveChats"
      @send="sendPrompt"
    />
  </div>
</template>

<style lang="scss" scoped>

  // Rancher's global `button` rule gives every button a 40px min-height and its own line-height;
  // these are compact, and only this component's own buttons are touched (scoped), never the
  // chat's.
  .conv button {
    min-height:  0;
    line-height: 1.4;
  }
  // The mockup's palette, sampled from documentation/conversation-mode/dashboard-mockup.png in
  // the interrupt-duty repo: pine ink for headings and primary actions, a warm grey page with white
  // cards, a green accent, and the status pairs (review, question, approval, blocked) as it draws
  // them. Light only, like the mockup, whatever Rancher's theme is.
  .conv {
    --conv-ink:          #152b27;
    --conv-on-ink:       #ffffff;
    --conv-page:         #f3f3f2;
    --conv-surface:      #ffffff;
    --conv-subtle:       #edf0ee;
    --conv-line:         #e6e8e6;
    --conv-text:         #152b27;
    --conv-muted:        #5c6560;
    --conv-meta:         #8c9299;
    --conv-accent:       #4cae6b;
    --conv-mint:         #e8f5ee;
    --conv-mint-line:    #d4e8db;
    // A row whose issue or pull request has a chat: plainly green, so it never reads as the grey
    // of a row whose chat has nothing to do ("Waiting review request"), which has no green in it.
    --conv-chat-bg:      #d4eedc;
    --conv-chat-edge:    #3d9a5c;
    --conv-quiet-bg:     #ececec;
    --conv-quiet-edge:   #9aa0a6;
    // A chat that is working is blue wherever it shows - its row, its rail item (the edge pulsing)
    // and its dot - so it stands apart from the mint every chat row has; waiting for you is orange.
    --conv-working-bg:   #d4e6ff;
    --conv-working:      #1d6ce0;
    --conv-working-line: #a6c8f5;
    --conv-waiting-bg:   #fdf0e6;
    --conv-orange:       #ee7a3b;
    --conv-orange-text:  #9f461d;
    --conv-link:         #3447ff;
    --conv-review-bg:    #d7defd;
    --conv-review:       #2634c5;
    --conv-question-bg:  #fbe7d8;
    --conv-question:     #853913;
    --conv-ok-bg:        #dcf4e6;
    --conv-ok:           #245838;
    --conv-blocked-bg:   #f7dfe1;
    --conv-blocked:      #8d2428;

    // Rancher's theme variables, re-pointed for everything inside this page - the chat (ChatPane)
    // reads these, so it takes the palette without a line of its own changing.
    --body-bg:      var(--conv-surface);
    --body-text:    var(--conv-text);
    --muted:        var(--conv-muted);
    --border:       var(--conv-line);
    --link:         var(--conv-link);
    --link-text:    #ffffff;
    --primary:      var(--conv-ink);
    --primary-text: var(--conv-on-ink);
    --success:      var(--conv-accent);
    --warning:      var(--conv-orange);
    --error:        var(--conv-blocked);
    --box-bg:       var(--conv-surface);
    --input-bg:     var(--conv-surface);
    --input-text:   var(--conv-text);
    --input-border: var(--conv-line);

    color-scheme:   light;
    display:        flex;
    flex-direction: column;
    height:         100vh;
    min-height:     0;
    background:     var(--conv-page);
    color:          var(--conv-text);

    &__top {
      display:       flex;
      flex-wrap:     wrap;
      align-items:   center;
      gap:           16px;
      padding:       10px 16px;
      border-bottom: 1px solid var(--conv-line);
      background:    var(--conv-surface);
    }

    &__brand {
      display:     flex;
      align-items: center;
      gap:         8px;
      font-weight: 600;
    }

    &__mark {
      display:         inline-flex;
      align-items:     center;
      justify-content: center;
      width:           26px;
      height:          26px;
      border-radius:   7px;
      background:      var(--conv-accent);
      color:           var(--conv-ink);
    }

    &__views,
    &__modes {
      display: flex;
      gap:     4px;
    }

    &__view,
    &__mode {
      display:         inline-flex;
      align-items:     center;
      gap:             6px;
      padding:         5px 12px;
      border:          0;
      border-radius:   16px;
      background:      none;
      color:           var(--body-text);
      cursor:          pointer;
      font-size:       13px;
      text-decoration: none;

      &:hover {
        background: var(--conv-subtle);
      }
    }

    &__view--on,
    &__view--on:hover {
      background:  var(--conv-ink);
      color:       var(--conv-on-ink);
      font-weight: 600;
    }

    &__mode {
      color:     var(--conv-muted);
      font-size: 12px;
    }

    &__count {
      min-width:     18px;
      padding:       0 5px;
      border-radius: 9px;
      background:    var(--conv-subtle);
      color:         var(--conv-muted);
      font-size:     11px;
      text-align:    center;

      &--warn {
        background: var(--conv-orange);
        color:      #ffffff;
      }
    }

    &__spacer {
      flex: 1;
    }

    &__back {
      display:     flex;
      align-items: center;
      gap:         4px;
      border:      0;
      background:  none;
      color:       var(--link);
      cursor:      pointer;
      font-size:   13px;
    }

    &__error {
      display:       flex;
      align-items:   center;
      gap:           8px;
      margin:        8px 16px 0;
      padding:       8px 12px;
      border-radius: 6px;
      background:    var(--conv-blocked-bg);
      color:         var(--conv-blocked);
      font-size:     13px;
    }

    &__error-close {
      margin-left: auto;
      border:      0;
      background:  none;
      color:       inherit;
      cursor:      pointer;
    }
  }

</style>
