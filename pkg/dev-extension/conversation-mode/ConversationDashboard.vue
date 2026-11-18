<script>
// Conversation mode's dashboard: what is going on, and the way into the chat about each thing.
//
// GitHub is asked the way My Work asks it (github.ts, myWork), once per product in projects.mjs,
// with the signed-in person's token. The chats, what each agent is doing and which chat is about
// which pull request come from the page around this (ConversationMode.vue). Every row that has a
// chat opens it; every row that has none can start one, named for it and opened with its link.
import AppIcon from '../components/focus/AppIcon.vue';
import { myWork } from '../github';
import {
  PROJECTS, mergeWork, attentionRows, chatsBySubject, subjectKey, subjectOf, shortRef, checksState, reviewState, pushedSinceReview, projectOf, ago, greeting
} from './projects.mjs';

/** GitHub again every five minutes while the dashboard is open. */
const REFRESH_MS = 5 * 60 * 1000;

/** What is asked of GitHub per product, one query each: see load(). */
const SECTIONS = [
  { label: 'pull requests', sections: ['mine'] },
  { label: 'reviews', sections: ['reviewing'] },
  { label: 'issues', sections: ['issues'] },
];

/** GitHub queries in flight at once. */
const CONCURRENCY = 3;

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

  emits: ['open-chat', 'start-chat', 'new-chat'],

  props: {
    chats:    { type: Array, default: () => [] },
    activity: { type: Object, default: () => ({}) },
    links:    { type: Object, default: () => ({}) },
    name:     { type: String, default: '' },
    starting: { type: String, default: '' },
  },

  data() {
    return {
      work:      {
        login: '', mine: [], reviewing: [], issues: []
      },
      errors:    [],
      loading:   true,
      loadedAt:  0,
      now:       Date.now(),
      filter:    'all',
      prTab:     'mine',
      issuesAll: false,
    };
  },

  async mounted() {
    await this.load();
    this.timer = setInterval(() => this.load(), REFRESH_MS);
    this.clock = setInterval(() => {
      this.now = Date.now();
    }, 30000);
  },

  beforeUnmount() {
    clearInterval(this.timer);
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

    shownAttention() {
      const f = FILTERS.find((x) => x.id === this.filter);

      return f?.kinds ? this.attention.filter((r) => f.kinds.includes(r.kind)) : this.attention;
    },

    counts() {
      const out = {};

      for (const f of FILTERS) {
        out[f.id] = f.kinds ? this.attention.filter((r) => f.kinds.includes(r.kind)).length : this.attention.length;
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

    prLists() {
      return {
        mine:      this.work.mine,
        requested: this.work.reviewing.filter((p) => p.reviewRequested),
        reviewed:  this.work.reviewing.filter((p) => !p.reviewRequested),
      };
    },

    prGroups() {
      return this.byProject(this.prLists[this.prTab] || []);
    },

    issueGroups() {
      return this.byProject(this.work.issues, this.issuesAll ? Infinity : 6);
    },

    updated() {
      return this.loadedAt ? ago(new Date(this.loadedAt).toISOString(), this.now) : '';
    },
  },

  methods: {
    /**
     * One question per product and per section, three at a time.
     *
     * myWork() with every section is one GraphQL query of four searches, and GitHub gives a query
     * ten seconds: for Rancher and Harvester that one query answered 502/504 after 10-11s, while
     * each section on its own answers in one to three. Three at a time keeps clear of GitHub's
     * limit on concurrent requests, and a 502/504 is asked once more before it is shown.
     */
    async load() {
      this.loading = true;
      const jobs = PROJECTS.flatMap((p) => SECTIONS.map((s) => ({ p, s })));
      const settled = new Array(jobs.length);
      let next = 0;
      const ask = async({ p, s }) => {
        try {
          return await myWork(p.repos, [], s.sections);
        } catch (e) {
          if (!/ 50[234]\b/.test(e?.message || '')) {
            throw e;
          }
          await new Promise((done) => setTimeout(done, 1500));

          return myWork(p.repos, [], s.sections);
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, async() => {
        while (next < jobs.length) {
          const at = next++;

          settled[at] = await ask(jobs[at]).then((value) => ({ value }), (reason) => ({ reason }));
        }
      }));

      this.errors = settled
        .map((r, i) => (r.reason ? `${ jobs[i].p.name } ${ jobs[i].s.label }: ${ r.reason?.message || r.reason }` : ''))
        .filter(Boolean);
      const answers = settled.map((r) => r.value || null);

      // Something that failed keeps nothing rather than the whole page emptying: what did answer
      // is shown, and the errors say what is missing.
      if (answers.some(Boolean)) {
        this.work = mergeWork(answers);
        this.loadedAt = Date.now();
      }
      this.loading = false;
    },

    byProject(list, cap = Infinity) {
      return PROJECTS.map((p) => {
        const items = list.filter((x) => projectOf(x.repo) === p.id)
          .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));

        return {
          id: p.id, name: p.name, items: items.slice(0, cap), more: Math.max(0, items.length - cap)
        };
      }).filter((g) => g.items.length);
    },

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

    chatButton(item, kind = 'pr') {
      const id = this.chatOf(item);

      if (id) {
        this.$emit('open-chat', id);
      } else {
        this.$emit('start-chat', subjectOf(item, kind));
      }
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
    stateLabel(id) {
      return STATE_LABEL[this.activity[id] || 'none'];
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
          <template v-if="loading && !loadedAt">
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
                @click="load"
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
      <section class="dash__card dash__attention">
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
        <p
          v-if="!shownAttention.length"
          class="dash__none"
        >
          {{ loading && !loadedAt ? 'Loading…' : 'Nothing here.' }}
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
              <a
                v-if="row.url"
                class="dash__row-title"
                :href="row.url"
                target="_blank"
                rel="noopener noreferrer"
              >{{ row.title }}</a>
              <span
                v-else
                class="dash__row-title"
              >{{ row.title }}</span>
              <span class="dash__row-meta">
                <template v-if="row.subject">{{ refOf(row.subject) }}</template>
                <template v-if="row.why"> · {{ row.why }}</template>
                <template v-if="row.at"> · {{ when(row.at) }}</template>
                <template v-if="row.kind === 'question'"> · the agent is waiting for your answer</template>
              </span>
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
      </section>

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
          v-if="!chats.length"
          class="dash__none"
        >
          No chats yet.
        </p>
        <ul class="dash__chatlist">
          <li
            v-for="chat in chats"
            :key="chat.id"
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
            </button>
          </li>
        </ul>
      </section>
    </div>

    <section class="dash__card">
      <header class="dash__card-head">
        <h2>Pull requests</h2>
        <div
          class="dash__chips"
          role="tablist"
          aria-label="Pull request lists"
        >
          <button
            v-for="t in [{ id: 'mine', label: 'Mine' }, { id: 'requested', label: 'Review requested' }, { id: 'reviewed', label: 'Reviewed by me' }]"
            :key="t.id"
            type="button"
            role="tab"
            class="dash__chip"
            :class="{ 'dash__chip--on': prTab === t.id }"
            :aria-selected="prTab === t.id ? 'true' : 'false'"
            @click="prTab = t.id"
          >
            {{ t.label }} {{ prLists[t.id].length }}
          </button>
        </div>
      </header>
      <p
        v-if="!prGroups.length"
        class="dash__none"
      >
        {{ loading && !loadedAt ? 'Loading…' : 'None.' }}
      </p>
      <div
        v-for="g in prGroups"
        :key="g.id"
        class="dash__group"
      >
        <h3>{{ g.name }}</h3>
        <div class="dash__table-wrap">
          <table class="dash__table">
            <tbody>
              <tr
                v-for="pr in g.items"
                :key="pr.key || refOf(pr)"
              >
                <td class="dash__td-title">
                  <a
                    :href="pr.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ pr.title }}</a>
                  <span class="dash__muted">{{ refOf(pr) }}<template v-if="prTab !== 'mine'"> · {{ pr.author }}</template></span>
                </td>
                <td>
                  <span
                    class="dash__pill"
                    :class="`dash__pill--${ checks(pr) }`"
                  >{{ checksText(pr) }}</span>
                </td>
                <td>
                  <span
                    class="dash__pill"
                    :class="`dash__pill--${ review(pr) }`"
                  >{{ reviewText(pr) }}</span>
                  <span
                    v-if="prTab === 'reviewed' && pushed(pr)"
                    class="dash__pill dash__pill--pending"
                  >pushed since</span>
                </td>
                <td class="dash__muted dash__nowrap">
                  {{ when(pr.updatedAt) }}
                </td>
                <td class="dash__td-action">
                  <button
                    type="button"
                    class="dash__btn"
                    :disabled="isStarting(pr)"
                    @click="chatButton(pr)"
                  >
                    {{ chatOf(pr) ? 'Open chat' : (isStarting(pr) ? 'Starting…' : 'Start chat') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="dash__card">
      <header class="dash__card-head">
        <h2>Issues assigned to you <span class="dash__muted">{{ work.issues.length }}</span></h2>
        <button
          v-if="work.issues.length > 6"
          type="button"
          class="dash__link"
          @click="issuesAll = !issuesAll"
        >
          {{ issuesAll ? 'Show fewer' : 'Show all' }}
        </button>
      </header>
      <p
        v-if="!issueGroups.length"
        class="dash__none"
      >
        {{ loading && !loadedAt ? 'Loading…' : 'None.' }}
      </p>
      <div
        v-for="g in issueGroups"
        :key="g.id"
        class="dash__group"
      >
        <h3>{{ g.name }} <span
          v-if="g.more"
          class="dash__muted"
        >+{{ g.more }} more</span></h3>
        <div class="dash__table-wrap">
          <table class="dash__table">
            <tbody>
              <tr
                v-for="issue in g.items"
                :key="issue.key || refOf(issue)"
              >
                <td class="dash__td-title">
                  <a
                    :href="issue.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ issue.title }}</a>
                  <span class="dash__muted">{{ refOf(issue) }}<template v-if="issue.milestone"> · {{ issue.milestone }}</template><template v-if="issue.projectStatus?.name"> · {{ issue.projectStatus.name }}</template></span>
                </td>
                <td class="dash__muted dash__nowrap">
                  {{ when(issue.updatedAt || issue.assignedAt) }}
                </td>
                <td class="dash__td-action">
                  <button
                    type="button"
                    class="dash__btn"
                    :disabled="isStarting(issue)"
                    @click="chatButton(issue, 'issue')"
                  >
                    {{ chatOf(issue) ? 'Open chat' : (isStarting(issue) ? 'Starting…' : 'Start chat') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
</template>

<style lang="scss" scoped>
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
      color:     var(--muted, #999);
      font-size: 13px;
    }

    &__greeting {
      font-size:   26px;
      font-weight: 600;
    }

    &__summary {
      margin:    4px 0 0;
      color:     var(--body-text);
      font-size: 14px;
    }

    &__updated {
      margin-left: 8px;
      color:       var(--muted, #999);
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
        color: var(--conv-warn);
      }
    }

    &__tile-value {
      font-size:   24px;
      font-weight: 600;
    }

    &__tile-label {
      color:     var(--muted, #999);
      font-size: 12px;
    }

    &__error {
      margin:        0 0 12px;
      padding:       8px 12px;
      border-radius: 6px;
      background:    rgba(214, 69, 69, 0.12);
      color:         var(--error, #d64545);
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
      padding:       14px 16px;
      border:        1px solid var(--border);
      border-radius: 12px;
      background:    var(--body-bg);

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
      color:     var(--muted, #999);
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
      &--rereview { background: rgba(80, 120, 230, 0.14); color: #4a6fd1; }
      &--question { background: rgba(245, 166, 35, 0.18); color: #b5730a; }
      &--blocked { background: rgba(214, 69, 69, 0.14); color: #c23b3b; }
      &--ready { background: rgba(48, 186, 120, 0.16); color: var(--conv-accent-text); }
    }

    &__row-main {
      display:        flex;
      flex:           1 1 260px;
      flex-direction: column;
      min-width:      0;
    }

    &__row-title {
      overflow:        hidden;
      color:           var(--body-text);
      font-weight:     600;
      text-decoration: none;
      text-overflow:   ellipsis;
      white-space:     nowrap;

      &:hover { text-decoration: underline; }
    }

    &__row-meta,
    &__muted {
      color:     var(--muted, #999);
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

    &__link {
      border:     0;
      background: none;
      color:      var(--link);
      cursor:     pointer;
      font-size:  12px;
      padding:    0;
    }

    &__chat {
      display:     flex;
      align-items: center;
      gap:         8px;
      width:       100%;
      padding:     8px 4px;
      border:      0;
      border-top:  1px solid var(--border);
      background:  none;
      color:       var(--body-text);
      cursor:      pointer;
      text-align:  left;

      &:hover { background: rgba(127, 127, 127, 0.08); }
    }

    &__chat-title {
      flex:          1 1 auto;
      overflow:      hidden;
      font-size:     13px;
      text-overflow: ellipsis;
      white-space:   nowrap;
    }

    &__chat-meta {
      color:       var(--muted, #999);
      font-size:   11px;
      white-space: nowrap;
    }

    &__dot {
      flex:          0 0 auto;
      width:         8px;
      height:        8px;
      border-radius: 50%;
      background:    var(--muted, #999);
      opacity:       0.5;

      &--working { background: var(--conv-accent); opacity: 1; }
      &--input { background: var(--warning, #f5a623); opacity: 1; }
      &--idle,
      &--finished { background: var(--conv-accent); opacity: 0.6; }
    }

    &__group {
      margin-top: 10px;

      h3 {
        margin-bottom:  4px;
        color:          var(--muted, #999);
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
      background:    rgba(127, 127, 127, 0.12);
      font-size:     11px;
      white-space:   nowrap;

      &--failing,
      &--changes { background: rgba(214, 69, 69, 0.14); color: #c23b3b; }
      &--pending { background: rgba(245, 166, 35, 0.18); color: #b5730a; }
      &--passing,
      &--approved { background: rgba(48, 186, 120, 0.16); color: var(--conv-accent-text); }
      &--draft { opacity: 0.8; }
    }
  }
</style>
