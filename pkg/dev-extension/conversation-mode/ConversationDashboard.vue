<script>
// Conversation mode's dashboard: what is going on, and the way into the chat about each thing.
//
// Everything it draws comes from the page around it (ConversationMode.vue): GitHub as myWork()
// answered it - loaded there once, kept across a switch of view and refreshed in the background -
// the chats, what each agent is doing and which chat is about which pull request. Every row that has a
// chat opens it; every row that has none can start one, named for it and opened with its link.
import AppIcon from '../components/focus/AppIcon.vue';
import { FIX_STEPS, REVIEW_STEPS } from '../workspace-rail';
import {
  CARDS, attentionRows, subjectKey, shortRef, cardSummary, ago, greeting
} from './projects.mjs';
import { railSections, isArchived } from './rail.mjs';
import { doingText } from './transcript-read.mjs';

/** Rows of "Needs your attention" shown before "Show all". */
const ATTENTION_SHOWN = 10;

const KIND_LABEL = {
  question: 'Question', blocked: 'Blocked', review: 'Review', rereview: 'Re-review', ready: 'Ready'
};

const FILTERS = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'reviews', label: 'Reviews', kinds: ['review', 'rereview'] },
  { id: 'blocked', label: 'Blocked', kinds: ['blocked'] },
  { id: 'questions', label: 'Questions', kinds: ['question'] },
  { id: 'ready', label: 'Ready', kinds: ['ready'] },
];

const STATE_LABEL = {
  working: 'Working', input: 'Waiting for you', idle: 'Idle', finished: 'Done', none: 'Not running'
};

export default {
  name: 'ConversationDashboard',

  components: { AppIcon },

  emits: ['open-chat', 'start-chat', 'new-chat', 'reload', 'archive', 'view-chats'],

  props: {
    chats:    { type: Array, default: () => [] },
    activity: { type: Object, default: () => ({}) },
    links:    { type: Object, default: () => ({}) },
    /** What each chat's transcript says (transcripts.ts): here, what an ongoing chat is doing. */
    transcripts: { type: Object, default: () => ({}) },
    name:     { type: String, default: '' },
    starting: { type: String, default: '' },
    work:     { type: Object, default: () => ({ login: '', mine: [], reviewing: [], issues: [] }) },
    errors:   { type: Array, default: () => [] },
    loading:  { type: Boolean, default: false },
    loadedAt: { type: Number, default: 0 },
    /** The software project cards' data from conversation-api (server/github.mjs, shapeProject). */
    projects: { type: Array, default: () => [] },
  },

  data() {
    return {
      now:       Date.now(),
      filter:    'all',
      attentionAll: false,
      /** The repositories "Needs your attention" is narrowed to: a chip's one, or a project card's. */
      repos:     [],
    };
  },

  mounted() {
    this.clock = setInterval(() => {
      this.now = Date.now();
    }, 30000);
  },

  beforeUnmount() {
    clearInterval(this.clock);
  },

  computed: {
    FILTERS: () => FILTERS,

    today() {
      return new Date(this.now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    },

    hello() {
      const who = this.name || this.work.login;

      return `${ greeting(new Date(this.now)) }${ who ? `, ${ who }` : '' }`;
    },

    attention() {
      return attentionRows(this.work, this.chats, this.activity, this.links);
    },

    /** The rows in the chosen repositories (all of them when none is chosen). */
    inRepos() {
      return this.repos.length ? this.attention.filter((r) => r.subject && this.repos.includes(r.subject.repo)) : this.attention;
    },

    /** One chip per repository with something in it, most first. */
    repoChips() {
      const n = {};

      for (const r of this.attention) {
        if (r.subject?.repo) {
          n[r.subject.repo] = (n[r.subject.repo] || 0) + 1;
        }
      }

      return Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([repo, count]) => ({ repo, count, label: repo.split('/').pop() }));
    },

    filteredAttention() {
      const f = FILTERS.find((x) => x.id === this.filter);

      return f?.kinds ? this.inRepos.filter((r) => f.kinds.includes(r.kind)) : this.inRepos;
    },

    /** The most urgent first, ATTENTION_SHOWN of them unless all were asked for. */
    shownAttention() {
      return this.attentionAll ? this.filteredAttention : this.filteredAttention.slice(0, ATTENTION_SHOWN);
    },

    counts() {
      const out = {};

      for (const f of FILTERS) {
        out[f.id] = f.kinds ? this.inRepos.filter((r) => f.kinds.includes(r.kind)).length : this.inRepos.length;
      }

      return out;
    },

    chatFor() {
      return chatsBySubject(this.chats, this.links);
    },

    tiles() {
      const working = this.chats.filter((c) => this.activity[c.id] === 'working').length;
      const waiting = this.chats.filter((c) => this.activity[c.id] === 'input').length;

      return [
        { label: 'Need your attention', value: this.attention.length, tone: this.attention.length ? 'warn' : '' },
        { label: waiting ? `Chats · ${ waiting } waiting on you` : 'Chats working', value: waiting ? this.chats.length : working, tone: waiting ? 'warn' : '' },
        { label: 'My open pull requests', value: this.work.mine.length, tone: '' },
        { label: 'Reviews asked of you', value: this.work.reviewing.filter((p) => p.reviewRequested).length, tone: '' },
      ];
    },


    /**
     * Your agent team at work: every issue and pull request a chat is on, and the chats about
     * nothing, as the rail groups them (rail.mjs) - what is over (merged, closed, cleared) left out.
     */
    /** The chats the Chats card lists: the archived ones are under Done in the rail. */
    liveChats() {
      return this.chats.filter((c) => !isArchived(this.links[c.id]));
    },

    archivedCount() {
      return this.chats.length - this.liveChats.length;
    },

    team() {
      return railSections(this.chats, this.links, this.work, this.activity)
        .filter((s) => s.id !== 'done')
        .flatMap((s) => s.items);
    },

    teamSummary() {
      const working = this.team.filter((i) => i.activity === 'working').length;
      const waiting = this.team.filter((i) => i.activity === 'input').length;
      const chats = this.team.reduce((n, i) => n + i.chatIds.length, 0);

      return [`${ this.team.length } item${ this.team.length === 1 ? '' : 's' }`, `${ chats } chat${ chats === 1 ? '' : 's' }`, working ? `${ working } working` : '', waiting ? `${ waiting } waiting on you` : ''].filter(Boolean).join(' · ');
    },

    /** The software project cards: what the server found, with what needs you and what the chats do there. */
    cards() {
      return CARDS.map((card) => cardSummary(card, this.projects.find((p) => p.id === card.id), this.attention, this.chats, this.links))
        .sort((a, b) => b.needYou - a.needYou);
    },

    milestones() {
      return this.cards.filter((c) => c.release).map((c) => ({
        ...c.release, name: c.name, initials: c.initials, done: Math.round(100 * c.release.closed / Math.max(1, c.release.open + c.release.closed))
      }));
    },

    updated() {
      return this.loadedAt ? ago(new Date(this.loadedAt).toISOString(), this.now) : '';
    },
  },

  methods: {


    refOf(item) {
      return shortRef(item.repo, item.number);
    },

    checksText(pr) {
      const state = checksState(pr);

      return state === 'failing' ? `${ pr.checks?.failing } failing` : { pending: 'running', passing: 'passing', none: 'no checks' }[state];
    },

    reviewText(pr) {
      return {
        draft: 'draft', changes: 'changes requested', approved: 'approved', waiting: 'review pending'
      }[reviewState(pr)];
    },

    chatOf(item) {
      return this.chatFor[subjectKey(item.repo, item.number)] || '';
    },

    chatTitle(id) {
      return this.chats.find((c) => c.id === id)?.title || '';
    },

    subjectFor(id) {
      const s = this.links[id]?.subject;

      return s ? shortRef(s.repo, s.number) : '';
    },


    rowChat(row) {
      if (row.chatId) {
        this.$emit('open-chat', row.chatId);
      } else if (row.subject) {
        this.$emit('start-chat', row.subject);
      }
    },

    isStarting(item) {
      return this.starting === subjectKey(item.repo, item.number);
    },

    kindLabel: (k) => KIND_LABEL[k] || k,

    /** The stage strip of a team row: the Dev product's steps for a fix or a review. */
    stepsOf(item) {
      if (!item.subject || item.status.stage < 0) {
        return [];
      }

      return item.role === 'reviewer' ? REVIEW_STEPS : FIX_STEPS;
    },

    /** done, now, waiting on you, or still to come - the mockup's four looks for a stage. */
    stageClass(item, i) {
      if (i < item.status.stage) {
        return 'dash__stage--done';
      }
      if (i > item.status.stage) {
        return 'dash__stage--todo';
      }

      return item.activity === 'input' || item.status.tone === 'warn' ? 'dash__stage--wait' : 'dash__stage--now';
    },

    teamStatus(item) {
      if (item.activity === 'input') {
        return { text: 'Waiting on you', tone: 'warn' };
      }
      if (item.activity === 'working') {
        return { text: 'Working', tone: 'ok' };
      }

      return { text: item.status.text || 'Idle', tone: item.status.tone };
    },

    /** A repository chip: narrow to it, or back to all. */
    pickRepo(repo) {
      this.repos = this.repos.length === 1 && this.repos[0] === repo ? [] : [repo];
    },

    /** A project card: narrow "Needs your attention" to its repositories (code and issues), and go there. */
    pickCard(card) {
      const repos = [...new Set([card.repo, card.issues])];

      this.repos = this.repos.join() === repos.join() ? [] : repos;
      this.$refs.attention?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    cardOn(card) {
      return this.repos.length && this.repos.join() === [...new Set([card.repo, card.issues])].join();
    },

    openItem(item) {
      this.$emit('open-chat', item.chatIds[0]);
    },

    buildText: (b) => ({
      passing: 'Passing', failing: 'Failing', running: 'Running'
    }[b] || '—'),
    stateLabel(id) {
      return STATE_LABEL[this.activity[id] || 'none'];
    },
    /** What an ongoing chat is doing, in a few words ('' for one that is not working or asking). */
    doing(id) {
      return id ? doingText(this.transcripts[id], this.activity[id]) : '';
    },
    /** The same for an item of the agent team: its most urgent chat that has something to say. */
    itemDoing(item) {
      const id = item.chatIds.find((c) => this.activity[c] === item.activity && this.doing(c));

      return id ? this.doing(id) : '';
    },
    stateOf(id) {
      return this.activity[id] || 'none';
    },
    checks: (pr) => checksState(pr),
    review: (pr) => reviewState(pr),
    pushed: (pr) => pushedSinceReview(pr),
    when(iso) {
      return ago(iso, this.now);
    },
  },
};
</script>

<template>
  <div
    class="dash"
    data-testid="conversation-dashboard"
  >
    <section class="dash__hello">
      <div>
        <p class="dash__date">
          {{ today }}
        </p>
        <h1 class="dash__greeting">
          {{ hello }}
        </h1>
        <p class="dash__summary">
          <template v-if="!loadedAt">
            Asking GitHub what is going on…
          </template>
          <template v-else>
            {{ attention.length ? `${ attention.length } thing${ attention.length === 1 ? ' is' : 's are' } waiting on you.` : 'Nothing is waiting on you.' }}
            <span class="dash__updated">
              Updated {{ updated }}
              <button
                type="button"
                class="dash__link"
                :disabled="loading"
                data-testid="conversation-dashboard-refresh"
                @click="$emit('reload')"
              >{{ loading ? 'refreshing…' : 'refresh' }}</button>
            </span>
          </template>
        </p>
      </div>
      <div class="dash__tiles">
        <div
          v-for="t in tiles"
          :key="t.label"
          class="dash__tile"
          :class="{ 'dash__tile--warn': t.tone === 'warn' }"
        >
          <span class="dash__tile-value">{{ t.value }}</span>
          <span class="dash__tile-label">{{ t.label }}</span>
        </div>
      </div>
    </section>

    <p
      v-for="e in errors"
      :key="e"
      class="dash__error"
      role="alert"
    >
      {{ e }}
    </p>

    <div class="dash__grid">
      <section
        ref="attention"
        class="dash__card dash__attention"
      >
        <header class="dash__card-head">
          <h2>Needs your attention</h2>
          <div
            class="dash__chips"
            role="group"
            aria-label="Filter"
          >
            <button
              v-for="f in FILTERS"
              :key="f.id"
              type="button"
              class="dash__chip"
              :class="{ 'dash__chip--on': filter === f.id }"
              :aria-pressed="filter === f.id ? 'true' : 'false'"
              @click="filter = f.id"
            >
              {{ f.label }} {{ counts[f.id] }}
            </button>
          </div>
        </header>
        <div
          v-if="repoChips.length > 1"
          class="dash__chips dash__repo-chips"
          role="group"
          aria-label="Repository"
        >
          <button
            type="button"
            class="dash__chip dash__chip--repo"
            :class="{ 'dash__chip--on': !repos.length }"
            @click="repos = []"
          >
            All repositories
          </button>
          <button
            v-for="c in repoChips"
            :key="c.repo"
            type="button"
            class="dash__chip dash__chip--repo"
            :class="{ 'dash__chip--on': repos.includes(c.repo) }"
            :title="c.repo"
            :data-testid="`attention-repo-${ c.label }`"
            @click="pickRepo(c.repo)"
          >
            {{ c.label }} {{ c.count }}
          </button>
        </div>
        <p
          v-if="!shownAttention.length"
          class="dash__none"
        >
          {{ !loadedAt ? 'Loading…' : 'Nothing here.' }}
        </p>
        <ul class="dash__rows">
          <li
            v-for="row in shownAttention"
            :key="row.kind + row.key"
            class="dash__row"
            :data-testid="`attention-${ row.kind }`"
          >
            <span
              class="dash__kind"
              :class="`dash__kind--${ row.kind }`"
            >{{ kindLabel(row.kind) }}</span>
            <div class="dash__row-main">
              <button
                type="button"
                class="dash__row-title"
                :title="row.chatId ? 'Open its chat' : 'Start a chat about it'"
                :disabled="!row.chatId && (!row.subject || isStarting(row.subject))"
                data-testid="attention-title"
                @click="rowChat(row)"
              >
                {{ row.title }}
              </button>
              <span class="dash__row-meta">
                <template v-if="row.subject">{{ refOf(row.subject) }}</template>
                <template v-if="row.why"> · {{ row.why }}</template>
                <template v-if="row.at"> · {{ when(row.at) }}</template>
                <template v-if="row.kind === 'question'"> · the agent is waiting for your answer</template>
              </span>
              <span
                v-if="doing(row.chatId)"
                class="dash__doing"
                :class="`dash__doing--${ stateOf(row.chatId) }`"
                data-testid="attention-doing"
              >{{ doing(row.chatId) }}</span>
            </div>
            <div class="dash__row-actions">
              <button
                type="button"
                class="dash__btn"
                :disabled="!!row.subject && isStarting(row.subject)"
                @click="rowChat(row)"
              >
                {{ row.chatId ? 'Open chat' : (row.subject && isStarting(row.subject) ? 'Starting…' : 'Start chat') }}
              </button>
              <a
                v-if="row.url"
                class="dash__btn dash__btn--primary"
                :href="row.url"
                target="_blank"
                rel="noopener noreferrer"
              >{{ row.kind === 'review' || row.kind === 'rereview' ? 'Review' : 'Open' }}</a>
            </div>
          </li>
        </ul>
        <button
          v-if="filteredAttention.length > shownAttention.length || attentionAll && filteredAttention.length > 10"
          type="button"
          class="dash__link dash__more"
          data-testid="attention-show-all"
          @click="attentionAll = !attentionAll"
        >
          {{ attentionAll ? 'Show the first 10' : `Show all ${ filteredAttention.length }` }}
        </button>
      </section>

      <div class="dash__side">
        <section class="dash__card dash__chats">
          <header class="dash__card-head">
            <h2>Chats</h2>
            <button
              type="button"
              class="dash__btn"
              @click="$emit('new-chat')"
            >
              <AppIcon
                name="plus"
                :size="12"
              /> New chat
            </button>
          </header>
          <p
            v-if="!liveChats.length"
            class="dash__none"
          >
            {{ chats.length ? 'Every chat is archived.' : 'No chats yet.' }}
          </p>
          <ul class="dash__chatlist">
            <li
              v-for="chat in liveChats"
              :key="chat.id"
              class="dash__chat-row"
            >
              <button
                type="button"
                class="dash__chat"
                :data-testid="`dashboard-chat-${ chat.id }`"
                @click="$emit('open-chat', chat.id)"
              >
                <span
                  class="dash__dot"
                  :class="`dash__dot--${ stateOf(chat.id) }`"
                />
                <span class="dash__chat-title">{{ chat.title }}</span>
                <span class="dash__chat-meta">
                  <template v-if="subjectFor(chat.id) && !chat.title.startsWith(subjectFor(chat.id))">{{ subjectFor(chat.id) }} · </template>{{ stateLabel(chat.id) }}
                </span>
                <span
                  v-if="doing(chat.id)"
                  class="dash__doing dash__chat-doing"
                  :class="`dash__doing--${ stateOf(chat.id) }`"
                  data-testid="dashboard-chat-doing"
                >{{ doing(chat.id) }}</span>
              </button>
              <button
                type="button"
                class="dash__chat-archive"
                :aria-label="`Archive ${ chat.title }`"
                title="Off the dashboard, under Done in Chats; the chat stays"
                @click="$emit('archive', { ids: [chat.id], archived: true })"
              >
                Archive
              </button>
            </li>
          </ul>
          <button
            v-if="archivedCount"
            type="button"
            class="dash__link dash__more"
            @click="$emit('view-chats')"
          >
            {{ archivedCount }} archived - under Done in Chats
          </button>
        </section>

        <section
          v-if="milestones.length"
          class="dash__card dash__milestones"
          data-testid="dashboard-milestones"
        >
          <header class="dash__card-head">
            <h2>Next milestones</h2>
          </header>
          <ul class="dash__ms-list">
            <li
              v-for="m in milestones"
              :key="m.name"
              class="dash__ms"
            >
              <a
                class="dash__ms-version"
                :href="m.url"
                target="_blank"
                rel="noopener noreferrer"
              >{{ m.title }}</a>
              <span class="dash__ms-text">
                <span class="dash__ms-name">{{ m.name }}</span>
                <span class="dash__muted">{{ m.open }} open · {{ m.closed }} closed</span>
              </span>
              <span
                class="dash__pill"
                :class="m.done >= 80 ? 'dash__pill--approved' : m.done >= 40 ? 'dash__pill--pending' : ''"
              >{{ m.done }}% done</span>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <section
      class="dash__card"
      data-testid="dashboard-team"
    >
      <header class="dash__card-head">
        <div>
          <h2>Your agent team at work</h2>
          <p class="dash__muted">
            {{ teamSummary }}
          </p>
        </div>
        <button
          type="button"
          class="dash__link"
          @click="$emit('view-chats')"
        >
          View all {{ chats.length }}
        </button>
      </header>
      <p
        v-if="!team.length"
        class="dash__none"
      >
        Nothing is being worked on. Start a chat from a row above, or from the Browser.
      </p>
      <div
        v-else
        class="dash__table-wrap"
      >
        <table class="dash__table dash__team">
          <thead>
            <tr>
              <th>Work item</th>
              <th>Stage</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in team"
              :key="item.key"
              class="dash__team-row"
              :data-testid="`team-${ item.key }`"
              @click="openItem(item)"
            >
              <td class="dash__td-title">
                <span class="dash__team-title">{{ item.title }}</span>
                <span class="dash__muted">{{ item.ref || 'Chat' }} · {{ item.role === 'other' ? 'Other' : item.role === 'reviewer' ? 'Reviewer' : 'Developer' }} · {{ item.chatIds.length }} chat{{ item.chatIds.length === 1 ? '' : 's' }}</span>
                <span
                  v-if="itemDoing(item)"
                  class="dash__doing"
                  :class="`dash__doing--${ item.activity }`"
                  data-testid="team-doing"
                >{{ itemDoing(item) }}</span>
              </td>
              <td>
                <div
                  v-if="stepsOf(item).length"
                  class="dash__stages"
                >
                  <span
                    v-for="(st, i) in stepsOf(item)"
                    :key="st.key"
                    class="dash__stage"
                    :class="stageClass(item, i)"
                  >{{ st.label }}</span>
                </div>
                <span
                  v-else
                  class="dash__muted"
                >—</span>
              </td>
              <td class="dash__nowrap">
                <span :class="`dash__status dash__status--${ teamStatus(item).tone || 'plain' }`">{{ teamStatus(item).text }}</span>
              </td>
              <td class="dash__td-action">
                <button
                  type="button"
                  class="dash__btn"
                  title="Archive: off this list, under Done in Chats; the chats stay"
                  @click.stop="$emit('archive', { ids: item.chatIds, archived: true })"
                >
                  Archive
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section
      class="dash__projects"
      data-testid="dashboard-projects"
    >
      <header class="dash__projects-head">
        <h2>Software projects</h2>
        <p class="dash__muted">
          {{ cards.length }} projects you work on{{ projects.length ? '' : ' - their releases, builds and bugs come from conversation-api' }}
        </p>
      </header>
      <div class="dash__cards">
        <article
          v-for="c in cards"
          :key="c.id"
          class="dash__proj"
          :class="{ 'dash__proj--needs': c.needYou, 'dash__proj--on': cardOn(c) }"
          role="button"
          tabindex="0"
          :aria-pressed="cardOn(c) ? 'true' : 'false'"
          :title="`Show what needs you in ${ c.name }`"
          :data-testid="`project-${ c.id }`"
          @click="pickCard(c)"
          @keydown.enter.prevent="pickCard(c)"
          @keydown.space.prevent="pickCard(c)"
        >
          <header class="dash__proj-head">
            <span class="dash__proj-avatar">{{ c.initials }}</span>
            <span class="dash__proj-id">
              <a
                class="dash__proj-name"
                :href="`https://github.com/${ c.repo }`"
                target="_blank"
                rel="noopener noreferrer"
                @click.stop
              >{{ c.name }}</a>
              <span class="dash__muted">{{ c.kind }}</span>
            </span>
            <span
              v-if="c.needYou"
              class="dash__proj-need"
            >{{ c.needYou }} need{{ c.needYou === 1 ? 's' : '' }} you</span>
          </header>
          <div class="dash__proj-release">
            <span class="dash__proj-release-text">
              <span class="dash__muted">Next release</span>
              <a
                v-if="c.release"
                :href="c.release.url"
                target="_blank"
                rel="noopener noreferrer"
                @click.stop
              >{{ c.release.title }}</a>
              <span v-else>—</span>
            </span>
            <span
              v-if="c.release"
              class="dash__pill"
            >{{ c.release.open }} open</span>
          </div>
          <dl class="dash__proj-facts">
            <div>
              <dt>Build</dt>
              <dd :class="`dash__build dash__build--${ c.build || 'none' }`">
                {{ buildText(c.build) }}
              </dd>
            </div>
            <div>
              <dt>Agent tasks</dt>
              <dd>{{ c.tasks }}</dd>
            </div>
            <div>
              <dt>Open bugs</dt>
              <dd>{{ c.bugs ?? '—' }}</dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  </div>
</template>

<style lang="scss" scoped>

  // Rancher's global `button` rule gives every button a 40px min-height and its own line-height;
  // these are compact, and only this component's own buttons are touched (scoped), never the
  // chat's.
  .dash button {
    min-height:  0;
    line-height: 1.4;
  }
  .dash {
    flex:       1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding:    20px 24px 40px;

    h1, h2, h3 {
      margin: 0;
    }

    &__hello {
      display:         flex;
      flex-wrap:       wrap;
      align-items:     flex-end;
      justify-content: space-between;
      gap:             16px;
      margin-bottom:   16px;
    }

    &__date {
      margin:    0;
      color:     var(--conv-meta);
      font-size: 13px;
    }

    &__greeting {
      font-size:   28px;
      font-weight: 600;
      color:       var(--conv-ink);
    }

    &__summary {
      margin:    4px 0 0;
      color:     var(--body-text);
      font-size: 14px;
    }

    &__updated {
      margin-left: 8px;
      color:       var(--conv-muted);
      font-size:   12px;
    }

    &__tiles {
      display:   flex;
      flex-wrap: wrap;
      gap:       10px;
    }

    &__tile {
      display:        flex;
      flex-direction: column;
      min-width:      130px;
      padding:        10px 14px;
      border:         1px solid var(--border);
      border-radius:  10px;
      background:     var(--body-bg);

      &--warn .dash__tile-value {
        color: var(--conv-orange-text);
      }
    }

    &__tile-value {
      font-size:   24px;
      font-weight: 600;
    }

    &__tile-label {
      color:     var(--conv-muted);
      font-size: 12px;
    }

    &__error {
      margin:        0 0 12px;
      padding:       8px 12px;
      border-radius: 6px;
      background:    var(--conv-blocked-bg);
      color:         var(--conv-blocked);
      font-size:     13px;
    }

    &__grid {
      display:               grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
      gap:                   16px;
      margin-bottom:         16px;

      @media (max-width: 1000px) {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    &__card {
      margin-bottom: 16px;
      padding:       16px 18px;
      border:        1px solid var(--conv-line);
      border-radius: 12px;
      background:    var(--conv-surface);

      .dash__grid & {
        margin-bottom: 0;
      }
    }

    &__card-head {
      display:         flex;
      flex-wrap:       wrap;
      align-items:     center;
      justify-content: space-between;
      gap:             8px;
      margin-bottom:   8px;

      h2 {
        font-size:   16px;
        font-weight: 600;
      }
    }

    &__chips {
      display:   flex;
      flex-wrap: wrap;
      gap:       6px;
    }

    &__repo-chips {
      margin: 0 0 6px;
    }

    &__chip--repo {
      font-size: 11px;
    }


    &__chat-archive {
      display:       none;
      flex:          0 0 auto;
      margin-right:  8px;
      padding:       2px 8px;
      border:        0;
      border-radius: 6px;
      background:    none;
      color:         var(--conv-muted);
      cursor:        pointer;
      font-size:     11px;

      &:hover,
      &:focus-visible {
        background: var(--conv-subtle);
        color:      var(--conv-ink);
      }
    }

    &__chip {
      padding:       3px 10px;
      border:        1px solid var(--border);
      border-radius: 14px;
      background:    none;
      color:         var(--body-text);
      cursor:        pointer;
      font-size:     12px;

      &--on {
        border-color: var(--conv-ink);
        background:   var(--conv-ink);
        color:        var(--conv-on-ink);
      }
    }

    &__none {
      margin:    8px 0;
      color:     var(--conv-muted);
      font-size: 13px;
    }

    &__rows,
    &__chatlist {
      margin:     0;
      padding:    0;
      list-style: none;
    }

    &__row {
      display:     flex;
      flex-wrap:   wrap;
      align-items: center;
      gap:         12px;
      padding:     10px 0;
      border-top:  1px solid var(--border);
    }

    &__kind {
      flex:          0 0 auto;
      width:         84px;
      padding:       3px 0;
      border-radius: 6px;
      font-size:     11px;
      font-weight:   600;
      text-align:    center;

      &--review,
      &--rereview { background: var(--conv-review-bg); color: var(--conv-review); }
      &--question { background: var(--conv-question-bg); color: var(--conv-question); }
      &--blocked { background: var(--conv-blocked-bg); color: var(--conv-blocked); }
      &--ready { background: var(--conv-ok-bg); color: var(--conv-ok); }
    }

    &__row-main {
      display:        flex;
      flex:           1 1 260px;
      flex-direction: column;
      min-width:      0;
    }

    &__row-title {
      overflow:        hidden;
      padding:         0;
      border:          0;
      background:      none;
      color:           var(--body-text);
      cursor:          pointer;
      font:            inherit;
      font-weight:     600;
      text-align:      left;
      text-decoration: none;
      text-overflow:   ellipsis;
      white-space:     nowrap;

      &:hover:not(:disabled) { text-decoration: underline; }
      &:disabled { cursor: default; }
    }

    // What an ongoing chat is doing: one line, the agent's colour while it works, orange while it asks.
    &__doing {
      display:       block;
      overflow:      hidden;
      color:         var(--conv-ink);
      font-size:     12px;
      text-overflow: ellipsis;
      white-space:   nowrap;

      &::before {
        content:       '';
        display:       inline-block;
        width:         6px;
        height:        6px;
        margin-right:  6px;
        border-radius: 50%;
        background:    var(--conv-accent);
        vertical-align: middle;
      }

      &--working::before { animation: dash-doing 1.4s ease-in-out infinite; }
      &--input::before { background: var(--conv-orange); }
    }

    &__row-meta,
    &__muted {
      color:     var(--conv-muted);
      font-size: 12px;
    }

    &__row-actions {
      display: flex;
      gap:     8px;
    }

    &__btn {
      display:         inline-flex;
      align-items:     center;
      gap:             4px;
      padding:         5px 12px;
      border:          1px solid var(--border);
      border-radius:   6px;
      background:      none;
      color:           var(--body-text);
      cursor:          pointer;
      font-size:       12px;
      text-decoration: none;
      white-space:     nowrap;

      &:disabled { opacity: 0.6; cursor: default; }

      &--primary {
        border-color: var(--conv-ink);
        background:   var(--conv-ink);
        color:        var(--conv-on-ink);
        font-weight:  600;
      }
    }

    &__more {
      margin-top: 8px;
    }

    &__link {
      border:     0;
      background: none;
      color:      var(--link);
      cursor:     pointer;
      font-size:  12px;
      padding:    0;
    }

    // The mockup's "My tasks": a mint panel of white rows.
    &__chats {
      border-color: var(--conv-mint-line);
      background:   var(--conv-mint);
    }

    &__chatlist {
      display:        flex;
      flex-direction: column;
      gap:            8px;
    }

    // A row is the white card; the chat and its Archive sit inside it, Archive at the end and only
    // while the row is pointed at or focused, so the chat's state stays readable.
    &__chat-row {
      display:       flex;
      align-items:   center;
      border:        1px solid var(--conv-line);
      border-radius: 10px;
      background:    var(--conv-surface);

      &:hover { border-color: var(--conv-mint-line); }

      &:hover .dash__chat-archive,
      &:focus-within .dash__chat-archive { display: inline-block; }
    }

    &__chat {
      display:     flex;
      flex:        1 1 auto;
      flex-wrap:   wrap;
      align-items: center;
      gap:         4px 8px;
      min-width:   0;
      padding:     10px 12px;
      border:      0;
      background:  none;
      color:       var(--body-text);
      cursor:      pointer;
      text-align:  left;
    }

    &__chat-title {
      flex:          1 1 0;
      min-width:     0;
      overflow:      hidden;
      font-size:     13px;
      text-overflow: ellipsis;
      white-space:   nowrap;
    }

    &__chat-meta {
      color:       var(--conv-muted);
      font-size:   11px;
      white-space: nowrap;
    }

    &__chat-doing {
      flex:         1 0 100%;
      padding-left: 16px;

      &::before { display: none; }
    }

    &__dot {
      flex:          0 0 auto;
      width:         8px;
      height:        8px;
      border-radius: 50%;
      background:    var(--conv-muted);
      opacity:       0.5;

      &--working { background: var(--conv-accent); opacity: 1; }
      &--input { background: var(--conv-orange); opacity: 1; }
      &--idle,
      &--finished { background: var(--conv-accent); opacity: 0.6; }
    }

    &__side {
      display:        flex;
      flex-direction: column;
      gap:            16px;
      min-width:      0;
    }

    // Next milestones: the version where the mockup has the date.
    &__ms-list {
      margin:     0;
      padding:    0;
      list-style: none;
    }

    &__ms {
      display:     flex;
      align-items: center;
      gap:         12px;
      padding:     8px 0;
      border-top:  1px solid var(--conv-line);
    }

    &__ms-version {
      flex:            0 0 72px;
      color:           var(--conv-ink);
      font-size:       15px;
      font-weight:     700;
      text-decoration: none;
    }

    &__ms-text {
      display:        flex;
      flex:           1 1 auto;
      flex-direction: column;
      min-width:      0;
    }

    &__ms-name {
      font-size:   13px;
      font-weight: 600;
    }

    // Your agent team at work.
    &__team {
      th {
        padding:        8px 8px 8px 0;
        color:          var(--conv-meta);
        font-size:      11px;
        font-weight:    600;
        letter-spacing: 0.04em;
        text-align:     left;
        text-transform: uppercase;
      }
    }

    &__team-row {
      cursor: pointer;

      &:hover td { background: var(--conv-page); }
    }

    &__team-title {
      display:     block;
      font-weight: 600;
    }

    &__stages {
      display:   flex;
      flex-wrap: wrap;
      gap:       6px;
    }

    &__stage {
      padding:       3px 10px;
      border:        1px solid transparent;
      border-radius: 6px;
      font-size:     12px;
      white-space:   nowrap;

      &--done { background: var(--conv-accent); color: #ffffff; }
      &--now { border-color: var(--conv-ink); background: var(--conv-surface); color: var(--conv-ink); font-weight: 600; }
      &--wait { border-color: var(--conv-orange); background: var(--conv-question-bg); color: var(--conv-question); font-weight: 600; }
      &--todo { background: var(--conv-subtle); color: var(--conv-meta); }
    }

    &__status {
      font-size: 13px;

      &--warn { color: var(--conv-orange-text); font-weight: 600; }
      &--ok { color: var(--conv-ok); font-weight: 600; }
    }

    // Software projects: the mockup's cards.
    &__projects {
      margin-top: 8px;
    }

    // Rancher's global header rule makes every <header> a row; this one is a title over a line.
    &__projects-head {
      display:       block;
      margin-bottom: 12px;

      h2 {
        color:       var(--conv-ink);
        font-size:   20px;
        font-weight: 600;
      }
    }

    &__cards {
      display:               grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap:                   16px;
    }

    &__proj {
      display:        flex;
      flex-direction: column;
      gap:            14px;
      padding:        16px;
      border:         1px solid var(--conv-line);
      border-radius:  14px;
      background:     var(--conv-surface);

      &--needs { border: 2px solid var(--conv-orange); }
      &--on { box-shadow: 0 0 0 3px var(--conv-ink); }

      cursor:     pointer;
      transition: box-shadow 0.12s ease;

      &:hover,
      &:focus-visible { box-shadow: 0 0 0 3px var(--conv-mint-line); outline: none; }
      &--on:hover { box-shadow: 0 0 0 3px var(--conv-ink); }
    }

    &__proj-head {
      display:     flex;
      align-items: center;
      gap:         12px;
    }

    &__proj-avatar {
      display:         inline-flex;
      flex:            0 0 40px;
      align-items:     center;
      justify-content: center;
      height:          40px;
      border-radius:   9px;
      background:      var(--conv-ink);
      color:           #ffffff;
      font-size:       14px;
      font-weight:     700;
    }

    &__proj-id {
      display:        flex;
      flex:           1 1 auto;
      flex-direction: column;
      min-width:      0;
    }

    &__proj-name {
      color:           var(--conv-ink);
      font-size:       15px;
      font-weight:     700;
      text-decoration: none;

      &:hover { text-decoration: underline; }
    }

    &__proj-need {
      padding:       2px 10px;
      border-radius: 12px;
      background:    var(--conv-orange);
      color:         #ffffff;
      font-size:     11px;
      font-weight:   700;
      white-space:   nowrap;
    }

    &__proj-release {
      display:         flex;
      align-items:     center;
      justify-content: space-between;
      gap:             8px;
      padding:         10px 12px;
      border-radius:   10px;
      background:      var(--conv-page);

      a {
        color:           var(--conv-ink);
        font-weight:     700;
        text-decoration: none;
      }
    }

    &__proj-release-text {
      display:        flex;
      flex-direction: column;
    }

    &__proj-facts {
      display:               grid;
      grid-template-columns: repeat(3, 1fr);
      margin:                0;

      dt {
        color:     var(--conv-meta);
        font-size: 11px;
      }

      dd {
        margin:      2px 0 0;
        font-weight: 700;
      }
    }

    &__build {
      &--passing { color: var(--conv-ok); }
      &--failing { color: var(--conv-blocked); }
      &--running { color: var(--conv-question); }
    }

    &__group {
      margin-top: 10px;

      h3 {
        margin-bottom:  4px;
        color:          var(--conv-muted);
        font-size:      12px;
        font-weight:    600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
    }

    &__table-wrap {
      overflow-x: auto;
    }

    &__table {
      width:           100%;
      border-collapse: collapse;
      font-size:       13px;

      td {
        padding:        7px 8px 7px 0;
        border-top:     1px solid var(--border);
        vertical-align: middle;
      }
    }

    &__td-title {
      min-width: 280px;

      a {
        display:         block;
        color:           var(--body-text);
        font-weight:     500;
        text-decoration: none;

        &:hover { text-decoration: underline; }
      }
    }

    &__td-action {
      text-align: right;
      width:      1%;
    }

    &__nowrap {
      white-space: nowrap;
    }

    &__pill {
      display:       inline-block;
      margin-right:  4px;
      padding:       1px 8px;
      border-radius: 10px;
      background:    var(--conv-subtle);
      color:         var(--conv-muted);
      font-size:     11px;
      white-space:   nowrap;

      &--failing,
      &--changes { background: var(--conv-blocked-bg); color: var(--conv-blocked); }
      &--pending { background: var(--conv-question-bg); color: var(--conv-question); }
      &--passing,
      &--approved { background: var(--conv-ok-bg); color: var(--conv-ok); }
      &--draft { opacity: 0.8; }
    }
  }

@keyframes dash-doing {
  50% { opacity: 0.25; }
}
</style>
