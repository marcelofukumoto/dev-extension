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
import {
  listConversations, startConversation, renameConversation, endConversation, conversationStates
} from '../conversations';
import { agentStateOf } from '../workspace-status';
import {
  DEV_PRODUCT, BLANK_CLUSTER, WORKSPACES_ROUTE, FOCUS_ROUTE
} from '../config/constants';
import { CONVERSATION_ROUTE } from './routes';
import { CONVERSATION_WORKSPACE, nextChatTitle } from './config.mjs';
import {
  PROJECTS, mergeWork, subjectKey, shortRef, chatTitleFor, openingMessage
} from './projects.mjs';
import {
  extractUrls, githubRef, titleFromMessage, isDefaultTitle, chatLinks
} from './linkify.mjs';
import { readLinks, updateLinks } from './links';
import { readTranscripts } from './transcripts';
import { myWork, pullRequest, issuesByNumber } from '../github';
import { fetchWork, requestRefresh, listenForWork } from './work-client';

/** How often what each agent is doing is asked again. */
const STATE_POLL_MS = 5000;

/** How often the transcripts are read: the links bar and the chats' names come from them. */
const TRANSCRIPT_POLL_MS = 20000;

/** GitHub in the background, whichever view is showing. */
const WORK_REFRESH_MS = 10 * 60 * 1000;

/** After a chat finishes a turn, GitHub again - but not more often than this. */
const WORK_AFTER_TURN_MS = 2 * 60 * 1000;

/** And a moment after the turn, so a push or a comment it made has landed. */
const WORK_AFTER_TURN_DELAY_MS = 15000;

/** The last answer, kept in this browser so the dashboard draws at once on the next visit. */
const WORK_CACHE_KEY = 'conversation-mode.work.v1';

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

  components: { AppIcon, ConversationChats, ConversationDashboard },

  data() {
    return {
      chats:        [],
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
      /** What each chat's transcript says (transcripts.ts): its first message and its links. */
      transcripts:  {},
      /** Chats this page has already tried to name, so a failed rename is not retried every poll. */
      titled:       {},
      /**
       * Where GitHub comes from: `server` (conversation-api asks and pushes; the page listens) or
       * `browser` (the page asks itself, every ten minutes) when the server cannot be reached.
       */
      workSource:   '',
    };
  },

  async mounted() {
    this.loadCachedWork();
    await Promise.all([this.loadChats(), this.loadLinks()]);
    this.poll = setInterval(() => this.refreshStates(), STATE_POLL_MS);
    this.transcriptPoll = setInterval(() => this.refreshTranscripts(), TRANSCRIPT_POLL_MS);
    this.refreshStates();
    this.refreshTranscripts();
    this.startWork();
  },

  beforeUnmount() {
    clearInterval(this.poll);
    clearInterval(this.transcriptPoll);
    clearInterval(this.workPoll);
    clearTimeout(this.workSoon);
    this.workListener?.close();
  },

  computed: {
    view() {
      return this.$route.query.view === 'chat' ? 'chat' : 'dashboard';
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
        if (v === 'chat') {
          this.chatsShown = true;
          if (!this.current && this.chats.length) {
            this.go('chat', this.chats[0].id, true);
          }
        }
      },
    },

    chats(list) {
      if (this.view === 'chat' && !this.current && list.length) {
        this.go('chat', list[0].id, true);
      }
    },
  },

  methods: {
    /** To a view (and a chat), keeping the route the single place both live. */
    go(view, id = '', replace = false) {
      const to = {
        name:   CONVERSATION_ROUTE,
        params: { product: DEV_PRODUCT, cluster: BLANK_CLUSTER },
        query:  view === 'chat' ? { view: 'chat' } : {},
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
      const states = await conversationStates().catch(() => null);

      if (!states) {
        return;
      }
      const activity = {};

      for (const s of states) {
        if (s.workspace === CONVERSATION_WORKSPACE) {
          activity[s.id] = agentStateOf(s);
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
          at: this.workLoadedAt, work: { ...this.work, mine: slim(this.work.mine), reviewing: slim(this.work.reviewing), issues: slim(this.work.issues) }
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

    async refreshTranscripts() {
      if (!this.chats.length || this.readingTranscripts) {
        return;
      }
      this.readingTranscripts = true;
      try {
        this.transcripts = await readTranscripts(this.chats.map((c) => c.id));
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
     */
    async createChat(subject = null, quiet = false) {
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
        const made = await startConversation(CONVERSATION_WORKSPACE, title, subject && !quiet ? openingMessage(subject) : '');

        this.chats = [...this.chats, { id: made.id, title: made.title || title, cli: '' }];
        if (subject) {
          this.links = await updateLinks((links) => {
            links[made.id] = { ...(links[made.id] || {}), subject };
          }).catch((e) => {
            this.error = `The chat started, but its link to ${ subject.url } was not saved: ${ e?.message || e }`;

            return { ...this.links, [made.id]: { subject } };
          });
        }
        this.go('chat', made.id);
      } catch (e) {
        this.error = `A new chat could not be started: ${ e?.message || e }`;
      } finally {
        this.creating = false;
        this.starting = '';
      }
    },

    openChat(id) {
      this.go('chat', id);
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

    async closeChat(id) {
      this.error = '';
      try {
        await endConversation(CONVERSATION_WORKSPACE, id);
        const at = this.chats.findIndex((c) => c.id === id);

        this.chats = this.chats.filter((c) => c.id !== id);
        if (this.links[id]) {
          this.links = await updateLinks((links) => {
            delete links[id];
          }).catch(() => this.links);
        }
        if (this.current === id) {
          const next = this.chats[Math.min(at, this.chats.length - 1)];

          this.go('chat', next ? next.id : '', true);
        }
      } catch (e) {
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
      :name="firstName"
      :starting="starting"
      :work="work"
      :errors="workErrors"
      :loading="workLoading"
      :loaded-at="workLoadedAt"
      @open-chat="openChat"
      @start-chat="createChat"
      @new-chat="createChat()"
      @reload="refreshWork('refresh button')"
    />
    <ConversationChats
      v-if="chatsShown"
      v-show="view === 'chat'"
      :chats="chats"
      :activity="activity"
      :links="links"
      :chat-links="chatLinksById"
      :work="work"
      :current="current"
      :loading="loadingChats"
      :creating="creating"
      @select="(id) => go('chat', id, true)"
      @create="(p) => createChat(p?.subject || null, !!p?.quiet)"
      @rename="renameChat"
      @close="closeChat"
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
