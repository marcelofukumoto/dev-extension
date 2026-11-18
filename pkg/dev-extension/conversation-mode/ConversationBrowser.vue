<script>
// Conversation mode's browser: every pull request and issue the dashboard knows about, with the
// filters to find the one you want, and the way into its chat.
//
// The dashboard says what needs you; this is the whole of the data behind it - your pull
// requests, the ones you are asked to review or have reviewed, the issues assigned to you - as
// conversation-api (or the page itself) answered it, from the page around this
// (ConversationMode.vue). Filtering is all here, on what is already loaded.
import {
  PROJECTS, subjectKey, subjectOf, shortRef, checksState, reviewState, pushedSinceReview, blockedReason, projectOf, chatsBySubject, ago
} from './projects.mjs';

const TABS = [
  { id: 'mine', label: 'My pull requests' },
  { id: 'requested', label: 'Review requested' },
  { id: 'reviewed', label: 'Reviewed by me' },
  { id: 'issues', label: 'Issues assigned to me' },
];

const EMPTY_FILTERS = () => ({
  product: '', repo: '', checks: '', review: '', chat: '', milestone: '', q: ''
});

export default {
  name: 'ConversationBrowser',

  emits: ['open-chat', 'start-chat'],

  props: {
    work:     { type: Object, default: () => ({ mine: [], reviewing: [], issues: [] }) },
    chats:    { type: Array, default: () => [] },
    links:    { type: Object, default: () => ({}) },
    starting: { type: String, default: '' },
    loadedAt: { type: Number, default: 0 },
  },

  data() {
    return {
      tab: 'mine', filters: EMPTY_FILTERS(), sort: 'updated', now: Date.now()
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
    TABS:     () => TABS,
    PROJECTS: () => PROJECTS,

    lists() {
      const reviewing = this.work.reviewing || [];

      return {
        mine:      this.work.mine || [],
        requested: reviewing.filter((p) => p.reviewRequested),
        reviewed:  reviewing.filter((p) => !p.reviewRequested),
        issues:    this.work.issues || [],
      };
    },

    isIssues() {
      return this.tab === 'issues';
    },

    chatFor() {
      return chatsBySubject(this.chats, this.links);
    },

    /** The repositories and milestones there are in this tab, for their filters. */
    repos() {
      return [...new Set(this.lists[this.tab].map((x) => x.repo))].sort();
    },

    milestones() {
      return [...new Set(this.lists.issues.map((x) => x.milestone).filter(Boolean))].sort();
    },

    filtered() {
      const f = this.filters;
      const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
      const rows = this.lists[this.tab].filter((x) => {
        if (f.product && projectOf(x.repo) !== f.product) {
          return false;
        }
        if (f.repo && x.repo !== f.repo) {
          return false;
        }
        if (f.chat && (f.chat === 'with') !== !!this.chatOf(x)) {
          return false;
        }
        if (this.isIssues) {
          if (f.milestone && (x.milestone || '') !== (f.milestone === '-' ? '' : f.milestone)) {
            return false;
          }
        } else {
          if (f.checks && checksState(x) !== f.checks) {
            return false;
          }
          if (f.review && reviewState(x) !== f.review) {
            return false;
          }
        }
        const text = `${ x.title } ${ shortRef(x.repo, x.number) } ${ x.author || '' } ${ (x.labels || []).join(' ') }`.toLowerCase();

        return words.every((w) => text.includes(w));
      });
      const at = (x) => Date.parse(x.updatedAt || '') || 0;

      return rows.sort((a, b) => (this.sort === 'oldest' ? at(a) - at(b) : at(b) - at(a)));
    },

    filtering() {
      return Object.values(this.filters).some(Boolean);
    },

    /** The filters, as rows of chips like the tabs above them: `{ id, label, options: [{ v, t }] }`. */
    groups() {
      const any = (t) => ({ v: '', t });
      const inTab = this.lists[this.tab];
      const out = [
        { id: 'product', label: 'Product', options: [any('All'), ...PROJECTS.map((p) => ({ v: p.id, t: p.name }))] },
        {
          id:      'repo',
          label:   'Repository',
          options: [any('All'), ...this.repos.map((r) => ({ v: r, t: `${ r.split('/').pop() } ${ inTab.filter((x) => x.repo === r).length }`, title: r }))],
        },
      ];

      if (this.isIssues) {
        out.push({ id: 'milestone', label: 'Milestone', options: [any('Any'), { v: '-', t: 'None' }, ...this.milestones.map((m) => ({ v: m, t: m }))] });
      } else {
        out.push({
          id: 'checks', label: 'Checks', options: [any('Any'), { v: 'failing', t: 'Failing' }, { v: 'pending', t: 'Running' }, { v: 'passing', t: 'Passing' }, { v: 'none', t: 'None' }]
        });
        out.push({
          id: 'review', label: 'Review', options: [any('Any'), { v: 'changes', t: 'Changes requested' }, { v: 'approved', t: 'Approved' }, { v: 'waiting', t: 'Pending' }, { v: 'draft', t: 'Draft' }]
        });
      }
      out.push({ id: 'chat', label: 'Chat', options: [any('Any'), { v: 'with', t: 'Has a chat' }, { v: 'without', t: 'No chat yet' }] });

      return out;
    },
  },

  watch: {
    tab() {
      // A repository or milestone picked in one tab may not exist in the next.
      this.filters.repo = '';
      this.filters.milestone = '';
    },
  },

  methods: {
    count(tab) {
      return this.lists[tab].length;
    },

    refOf: (x) => shortRef(x.repo, x.number),

    chatOf(x) {
      return this.chatFor[subjectKey(x.repo, x.number)] || '';
    },

    isStarting(x) {
      return this.starting === subjectKey(x.repo, x.number);
    },

    chatButton(x) {
      const id = this.chatOf(x);

      if (id) {
        this.$emit('open-chat', id);
      } else {
        this.$emit('start-chat', { ...subjectOf(x, this.isIssues ? 'issue' : 'pr'), role: this.isIssues || this.tab === 'mine' ? 'developer' : 'reviewer' });
      }
    },

    checks: (pr) => checksState(pr),
    review: (pr) => reviewState(pr),
    pushed: (pr) => pushedSinceReview(pr),

    checksText(pr) {
      const state = checksState(pr);

      return state === 'failing' ? `${ pr.checks?.failing } failing` : { pending: 'running', passing: 'passing', none: 'no checks' }[state];
    },

    reviewText(pr) {
      return {
        draft: 'draft', changes: 'changes requested', approved: 'approved', waiting: 'review pending'
      }[reviewState(pr)];
    },

    reason(pr) {
      return blockedReason(pr);
    },

    when(iso) {
      return ago(iso, this.now);
    },

    clearFilters() {
      this.filters = EMPTY_FILTERS();
    },
  },
};
</script>

<template>
  <div
    class="br"
    data-testid="conversation-browser"
  >
    <header class="br__head">
      <div>
        <h1 class="br__title">
          Browser
        </h1>
        <p class="br__muted">
          Every pull request and issue behind the dashboard{{ loadedAt ? `, as of ${ when(new Date(loadedAt).toISOString()) }` : '' }}.
        </p>
      </div>
      <div
        class="br__tabs"
        role="tablist"
        aria-label="Lists"
      >
        <button
          v-for="t in TABS"
          :key="t.id"
          type="button"
          role="tab"
          class="br__tab"
          :class="{ 'br__tab--on': tab === t.id }"
          :aria-selected="tab === t.id ? 'true' : 'false'"
          :data-testid="`browser-tab-${ t.id }`"
          @click="tab = t.id"
        >
          {{ t.label }} <span class="br__count">{{ count(t.id) }}</span>
        </button>
      </div>
    </header>

    <div
      class="br__filters"
      role="group"
      aria-label="Filters"
    >
      <input
        v-model="filters.q"
        type="search"
        class="br__search"
        placeholder="Search titles, numbers, authors, labels"
        aria-label="Search"
        data-testid="browser-search"
      >
      <div
        v-for="g in groups"
        :key="g.id"
        class="br__group"
        role="group"
        :aria-label="g.label"
      >
        <span class="br__group-label">{{ g.label }}</span>
        <button
          v-for="o in g.options"
          :key="o.v"
          type="button"
          class="br__chip"
          :class="{ 'br__chip--on': filters[g.id] === o.v }"
          :aria-pressed="filters[g.id] === o.v ? 'true' : 'false'"
          :title="o.title || ''"
          :data-testid="`browser-${ g.id }-${ o.v || 'any' }`"
          @click="filters[g.id] = o.v"
        >
          {{ o.t }}
        </button>
      </div>
      <div
        class="br__group"
        role="group"
        aria-label="Sort"
      >
        <span class="br__group-label">Sort</span>
        <button
          v-for="o in [{ v: 'updated', t: 'Recently updated' }, { v: 'oldest', t: 'Least recently updated' }]"
          :key="o.v"
          type="button"
          class="br__chip"
          :class="{ 'br__chip--on': sort === o.v }"
          @click="sort = o.v"
        >
          {{ o.t }}
        </button>
      </div>
      <span class="br__result">
        {{ filtered.length }} of {{ count(tab) }}
        <button
          v-if="filtering"
          type="button"
          class="br__link"
          @click="clearFilters"
        >Clear filters</button>
      </span>
    </div>

    <div class="br__card">
      <p
        v-if="!loadedAt"
        class="br__none"
      >
        Loading…
      </p>
      <p
        v-else-if="!filtered.length"
        class="br__none"
      >
        Nothing matches.
      </p>
      <div
        v-else
        class="br__table-wrap"
      >
        <table class="br__table">
          <thead>
            <tr v-if="!isIssues">
              <th>Pull request</th>
              <th>Checks</th>
              <th>Review</th>
              <th v-if="tab === 'mine'">
                Why it is blocked
              </th>
              <th>Updated</th>
              <th />
            </tr>
            <tr v-else>
              <th>Issue</th>
              <th>Milestone</th>
              <th>Labels</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="x in filtered"
              :key="x.key || refOf(x)"
            >
              <td class="br__td-title">
                <button
                  type="button"
                  class="br__title"
                  :title="chatOf(x) ? 'Open its chat' : 'Start a chat about it'"
                  :disabled="isStarting(x)"
                  data-testid="browser-title"
                  @click="chatButton(x)"
                >
                  {{ x.title }}
                </button>
                <span class="br__muted">{{ refOf(x) }}<template v-if="!isIssues && tab !== 'mine'"> · {{ x.author }}</template></span>
              </td>
              <template v-if="!isIssues">
                <td>
                  <span
                    class="br__pill"
                    :class="`br__pill--${ checks(x) }`"
                  >{{ checksText(x) }}</span>
                </td>
                <td>
                  <span
                    class="br__pill"
                    :class="`br__pill--${ review(x) }`"
                  >{{ reviewText(x) }}</span>
                  <span
                    v-if="tab === 'reviewed' && pushed(x)"
                    class="br__pill br__pill--pending"
                  >pushed since</span>
                </td>
                <td
                  v-if="tab === 'mine'"
                  class="br__why"
                >
                  {{ reason(x) }}
                </td>
              </template>
              <template v-else>
                <td class="br__nowrap">
                  {{ x.milestone || '—' }}
                </td>
                <td>
                  <span
                    v-for="l in (x.labels || []).slice(0, 3)"
                    :key="l"
                    class="br__pill"
                  >{{ l }}</span>
                </td>
              </template>
              <td class="br__muted br__nowrap">
                {{ when(x.updatedAt) }}
              </td>
              <td class="br__td-action">
                <button
                  type="button"
                  class="br__btn"
                  :disabled="isStarting(x)"
                  @click="chatButton(x)"
                >
                  {{ chatOf(x) ? 'Open chat' : (isStarting(x) ? 'Starting…' : 'Start chat') }}
                </button>
                <a
                  class="br__btn br__gh"
                  :href="x.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  :aria-label="`${ refOf(x) } on GitHub`"
                >GitHub</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .br button {
    min-height:  0;
    line-height: 1.4;
  }

  .br {
    flex:       1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding:    20px 24px 40px;

    h1 {
      margin: 0;
    }

    &__head {
      display:         flex;
      flex-wrap:       wrap;
      align-items:     flex-end;
      justify-content: space-between;
      gap:             12px;
      margin-bottom:   14px;
    }

    &__title {
      color:       var(--conv-ink);
      font-size:   24px;
      font-weight: 600;
    }

    &__muted {
      margin:    0;
      color:     var(--conv-meta);
      font-size: 12px;
    }

    &__tabs {
      display:   flex;
      flex-wrap: wrap;
      gap:       6px;
    }

    &__tab {
      padding:       5px 12px;
      border:        1px solid var(--conv-line);
      border-radius: 16px;
      background:    var(--conv-surface);
      color:         var(--conv-text);
      cursor:        pointer;
      font-size:     13px;

      &--on {
        border-color: var(--conv-ink);
        background:   var(--conv-ink);
        color:        var(--conv-on-ink);
      }
    }

    &__count {
      margin-left: 4px;
      opacity:     0.75;
    }

    &__filters {
      display:        flex;
      flex-direction: column;
      gap:            8px;
      margin-bottom:  12px;
    }

    &__search {
      height:        34px;
      padding:       0 12px;
      border:        1px solid var(--conv-line);
      border-radius: 8px;
      background:    var(--conv-surface);
      color:         var(--conv-text);
      font-size:     13px;
    }

    &__group {
      display:     flex;
      flex-wrap:   wrap;
      align-items: center;
      gap:         6px;
    }

    &__group-label {
      flex:           0 0 90px;
      color:          var(--conv-meta);
      font-size:      11px;
      font-weight:    600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    &__chip {
      padding:       3px 10px;
      border:        1px solid var(--conv-line);
      border-radius: 14px;
      background:    var(--conv-surface);
      color:         var(--conv-text);
      cursor:        pointer;
      font-size:     12px;

      &:hover { border-color: var(--conv-ink); }

      &--on {
        border-color: var(--conv-ink);
        background:   var(--conv-ink);
        color:        var(--conv-on-ink);
      }
    }

    &__result {
      align-self: flex-end;
      color:       var(--conv-muted);
      font-size:   12px;
    }

    &__link {
      margin-left: 8px;
      padding:     0;
      border:      0;
      background:  none;
      color:       var(--conv-link);
      cursor:      pointer;
      font-size:   12px;
    }

    &__card {
      padding:       6px 16px;
      border:        1px solid var(--conv-line);
      border-radius: 12px;
      background:    var(--conv-surface);
    }

    &__none {
      margin:    12px 0;
      color:     var(--conv-muted);
      font-size: 13px;
    }

    &__table-wrap {
      overflow-x: auto;
    }

    &__table {
      width:           100%;
      border-collapse: collapse;
      font-size:       13px;

      th {
        padding:        10px 8px 8px 0;
        color:          var(--conv-meta);
        font-size:      11px;
        font-weight:    600;
        letter-spacing: 0.04em;
        text-align:     left;
        text-transform: uppercase;
      }

      td {
        padding:        8px 8px 8px 0;
        border-top:     1px solid var(--conv-line);
        vertical-align: middle;
      }
    }

    &__td-title {
      min-width: 300px;
    }

    &__title {
      display:     block;
      padding:     0;
      border:      0;
      background:  none;
      color:       var(--conv-text);
      cursor:      pointer;
      font:        inherit;
      font-weight: 500;
      text-align:  left;

      &:hover:not(:disabled) { text-decoration: underline; }
      &:disabled { cursor: default; }
    }

    &__why {
      max-width: 340px;
      color:     var(--conv-blocked);
      font-size: 12px;
    }

    &__td-action {
      width:       1%;
      text-align:  right;
      white-space: nowrap;
    }

    &__gh {
      display:         inline-block;
      margin-left:     6px;
      text-decoration: none;
    }

    &__nowrap {
      white-space: nowrap;
    }

    &__btn {
      padding:       5px 12px;
      border:        1px solid var(--conv-line);
      border-radius: 6px;
      background:    var(--conv-surface);
      color:         var(--conv-text);
      cursor:        pointer;
      font-size:     12px;
      white-space:   nowrap;

      &:disabled { opacity: 0.6; cursor: default; }
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
    }
  }
</style>
