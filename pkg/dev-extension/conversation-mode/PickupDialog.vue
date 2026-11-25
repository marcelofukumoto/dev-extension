<script>
// "Find work", opened from Needs your attention: the issues there are to pick up, one tab per
// project view or search (pickup.mjs), narrowed to a milestone, with the ones somebody already
// started set aside behind "Show started". A row opens its chat, or starts one, and opens the issue.
// The answer is conversation-api's (pickup-client.ts); a chat's state colours its row, as on the
// dashboard.
import AppIcon from '../components/focus/AppIcon.vue';
import { fetchPickup } from './pickup-client';
import { startedBy, milestonesOf } from './pickup.mjs';
import {
  subjectKey, subjectOf, chatsBySubject, ago
} from './projects.mjs';
import { activityBySubject } from './rail.mjs';

const STORE = 'conversation-pickup';
const ALL = '*';
const NONE = '';

function remembered() {
  try {
    return JSON.parse(window.localStorage.getItem(STORE) || '{}') || {};
  } catch {
    return {};
  }
}

export default {
  name: 'PickupDialog',

  components: { AppIcon },

  emits: ['close', 'open-chat', 'start-chat'],

  props: {
    chats:    { type: Array, default: () => [] },
    links:    { type: Object, default: () => ({}) },
    activity: { type: Object, default: () => ({}) },
    /** `repo#n` of the chat being started, so its button says so. */
    starting: { type: String, default: '' },
    /** Your login: a pull request of yours says "yours". */
    me:       { type: String, default: '' },
    /** Your work (mergeWork): an issue a pull request of yours fixes has that pull request's chat. */
    work:     { type: Object, default: null },
  },

  data() {
    const kept = remembered();

    return {
      answer:      null,
      loading:     true,
      error:       '',
      tab:         kept.tab || '',
      milestones:  kept.milestones || {},
      showStarted: false,
      now:         Date.now(),
    };
  },

  async mounted() {
    this.opener = document.activeElement;
    this.$refs.dialog?.focus();
    this.tick = setInterval(() => {
      this.now = Date.now();
    }, 30000);
    await this.load(false);
  },

  beforeUnmount() {
    clearInterval(this.tick);
    this.opener?.focus?.();
  },

  computed: {
    tabs() {
      return (this.answer?.tabs || []).map((t) => {
        const issues = t.issues.map((i) => ({ ...i, started: startedBy(i) }));
        const free = issues.filter((i) => !i.started.started);
        const m = this.milestones[t.id] ?? ALL;

        return {
          ...t, issues, free, count: m === ALL ? free.length : free.filter((i) => i.milestone === m).length
        };
      });
    },

    current() {
      return this.tabs.find((t) => t.id === this.tab) || this.tabs[0] || null;
    },

    milestone() {
      return this.current ? (this.milestones[this.current.id] ?? ALL) : ALL;
    },

    /** What the table shows before the milestone narrows it: every issue, or the ones nobody started. */
    shownIssues() {
      return this.current ? (this.showStarted ? this.current.issues : this.current.free) : [];
    },

    /**
     * Every milestone of the tab - started issues' too, so a milestone whose work is all taken is
     * still there, at 0 - with how many the table would show in it.
     */
    milestoneOptions() {
      if (!this.current) {
        return [];
      }
      const n = {};

      for (const i of this.shownIssues) {
        n[i.milestone] = (n[i.milestone] || 0) + 1;
      }

      return milestonesOf(this.current.issues).map((m) => ({ title: m.title, count: n[m.title] || 0 }));
    },

    /** Started issues in the chosen milestone: why it can be empty. */
    startedInMilestone() {
      if (!this.current || this.showStarted) {
        return 0;
      }

      return this.current.issues.filter((i) => i.started.started && (this.milestone === ALL || i.milestone === this.milestone)).length;
    },

    startedCount() {
      return this.current ? this.current.issues.length - this.current.free.length : 0;
    },

    /** The rows: the tab's issues in the milestone, started ones only when asked for, the last updated first. */
    rows() {
      if (!this.current) {
        return [];
      }
      const list = this.showStarted ? this.current.issues : this.current.free;

      return list
        .filter((i) => this.milestone === ALL || i.milestone === this.milestone)
        .slice()
        .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
    },

    chatFor() {
      return chatsBySubject(this.chats, this.links, this.work);
    },

    subjectActivity() {
      return activityBySubject(this.chats, this.links, this.activity, this.work);
    },

    askedAt() {
      return this.answer?.at ? ago(new Date(this.answer.at).toISOString(), this.now) : '';
    },
  },

  watch: {
    tab: 'remember',
    milestones: { handler: 'remember', deep: true },
  },

  methods: {
    async load(refresh) {
      this.loading = true;
      this.error = '';
      try {
        this.answer = await fetchPickup(refresh);
        if (!this.tabs.some((t) => t.id === this.tab)) {
          this.tab = this.tabs[0]?.id || '';
        }
      } catch (e) {
        this.error = `Find work could not be read: ${ e?.message || e }`;
      } finally {
        this.loading = false;
      }
    },

    remember() {
      try {
        window.localStorage.setItem(STORE, JSON.stringify({ tab: this.tab, milestones: this.milestones }));
      } catch {
        // A private window or blocked storage: the choice lasts as long as the dialog.
      }
    },

    setMilestone(value) {
      this.milestones = { ...this.milestones, [this.current.id]: value };
    },

    milestoneLabel: (m) => (m.title || 'No milestone'),

    chatOf(issue) {
      return this.chatFor[subjectKey(issue.repo, issue.number)] || '';
    },

    rowState(issue) {
      return this.chatOf(issue) ? (this.subjectActivity[issue.key] || 'none') : '';
    },

    isStarting(issue) {
      return this.starting === subjectKey(issue.repo, issue.number);
    },

    chatButton(issue) {
      const id = this.chatOf(issue);

      if (id) {
        this.$emit('open-chat', id);
      } else {
        // Opened with the doable-or-not check (projects.mjs, pickupMessage), not the where-it-stands one.
        this.$emit('start-chat', { ...subjectOf(issue, 'issue'), role: 'developer' }, { opening: 'pickup' });
      }
    },

    shortRepo: (repo) => repo.split('/').pop(),

    /** Another issue as this row names it: `#19853` in its own repository, `harvester#11667` elsewhere. */
    refOf(issue, other) {
      return other.repo === issue.repo ? `#${ other.number }` : `${ this.shortRepo(other.repo) }#${ other.number }`;
    },

    /** The labels worth a glance: kind, priority, area and the JIRA mark; the rest are in the issue. */
    labelsOf: (issue) => issue.labels.filter((l) => /^(kind|priority|area)\/|^JIRA$/i.test(l.name)).slice(0, 4),

    whose(p) {
      return p.author && p.author === this.me ? 'yours' : (p.author ? `by ${ p.author }` : '');
    },

    prText: (p) => `${ p.repo.split('/').pop() }#${ p.number } ${ p.state === 'MERGED' ? 'merged' : (p.draft ? 'draft' : 'open') }`,

    when(iso) {
      return ago(iso, this.now);
    },

    onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.$emit('close');
      }
    },
  },
};
</script>

<template>
  <div
    class="pk"
    data-testid="pickup"
    @click.self="$emit('close')"
  >
    <section
      ref="dialog"
      class="pk__dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pk-title"
      tabindex="-1"
      @keydown="onKey"
    >
      <header class="pk__head">
        <h2 id="pk-title">
          Find work
        </h2>
        <span class="pk__asked">
          <template v-if="loading">Asking GitHub…</template>
          <template v-else-if="askedAt">Updated {{ askedAt }}</template>
        </span>
        <button
          type="button"
          class="pk__btn"
          :disabled="loading"
          data-testid="pickup-refresh"
          @click="load(true)"
        >
          Refresh
        </button>
        <button
          type="button"
          class="pk__close"
          aria-label="Close"
          data-testid="pickup-close"
          @click="$emit('close')"
        >
          <AppIcon
            name="cross"
            :size="16"
          />
        </button>
      </header>

      <p
        v-if="error"
        class="pk__error"
      >
        {{ error }}
      </p>

      <div
        v-if="tabs.length"
        class="pk__tabs"
        role="tablist"
        aria-label="Where the work is"
      >
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          role="tab"
          class="pk__tab"
          :class="{ 'pk__tab--on': current && t.id === current.id }"
          :aria-selected="current && t.id === current.id ? 'true' : 'false'"
          :data-testid="`pickup-tab-${ t.id }`"
          @click="tab = t.id"
        >
          {{ t.name }} <span class="pk__count">{{ t.count }}</span>
        </button>
      </div>

      <div
        v-if="current"
        class="pk__bar"
      >
        <label class="pk__field">
          Milestone
          <select
            :value="milestone"
            data-testid="pickup-milestone"
            @change="setMilestone($event.target.value)"
          >
            <option value="*">All milestones ({{ shownIssues.length }})</option>
            <option
              v-for="m in milestoneOptions"
              :key="m.title || 'none'"
              :value="m.title"
            >
              {{ milestoneLabel(m) }} ({{ m.count }})
            </option>
          </select>
        </label>
        <label
          class="pk__field pk__field--check"
          :title="'Issues a pull request fixes (linked, or Fixes ...), open or merged, or with a Working / Review status. A pull request that only mentions an issue never sets it aside.'"
        >
          <input
            v-model="showStarted"
            type="checkbox"
            data-testid="pickup-show-started"
          >
          Show started ({{ startedCount }})
        </label>
        <span class="pk__total">{{ rows.length }} {{ rows.length === 1 ? 'issue' : 'issues' }}</span>
        <a
          class="pk__github"
          :href="current.url"
          target="_blank"
          rel="noopener noreferrer"
          :title="current.filter"
        >On GitHub</a>
      </div>
      <p
        v-if="current && current.error"
        class="pk__error"
      >
        {{ current.name }} could not be read this time: {{ current.error }}. Showing what it had.
      </p>
      <p
        v-if="current && current.truncated"
        class="pk__note"
      >
        Only the first {{ current.issues.length }} of {{ current.total }} are here: GitHub has more.
      </p>

      <div class="pk__scroll">
        <table
          v-if="rows.length"
          class="pk__table"
        >
          <thead>
            <tr>
              <th>Issue</th>
              <th>Status</th>
              <th>Milestone</th>
              <th>Priority</th>
              <th>Assignees</th>
              <th>Updated</th>
              <th><span class="pk__sr">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="i in rows"
              :key="i.key"
              class="pk__row"
              :class="[{ 'pk__row--chat': chatOf(i), 'pk__row--started': i.started.started }, rowState(i) ? `pk__row--${ rowState(i) }` : '']"
              :data-chat-state="rowState(i) || null"
              data-testid="pickup-row"
            >
              <td class="pk__issue">
                <button
                  type="button"
                  class="pk__title"
                  :title="chatOf(i) ? 'Open its chat' : 'Start a chat about it'"
                  :disabled="isStarting(i)"
                  @click="chatButton(i)"
                >
                  {{ i.title }}
                </button>
                <span class="pk__meta">
                  {{ shortRepo(i.repo) }}#{{ i.number }}
                  <span
                    v-for="l in labelsOf(i)"
                    :key="l.name"
                    class="pk__label"
                  >{{ l.name }}</span>
                </span>
                <!-- A backport and its issue name each other (pickup.mjs, backportOf / backportsOf). -->
                <span
                  v-if="i.backportOf"
                  class="pk__backport"
                  data-testid="pickup-backport-of"
                >
                  Backport from
                  <a
                    :href="i.backportOf.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ refOf(i, i.backportOf) }}</a>
                </span>
                <span
                  v-if="(i.backports || []).length"
                  class="pk__backport"
                  data-testid="pickup-backports"
                >
                  Backport for
                  <span
                    v-for="(b, n) in i.backports"
                    :key="b.url"
                  >{{ b.version ? `${ b.version }: ` : '' }}<a
                    :href="b.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ refOf(i, b) }}</a>{{ b.state === 'CLOSED' ? ' (closed)' : '' }}{{ n < i.backports.length - 1 ? ' · ' : '' }}</span>
                </span>
                <span
                  v-if="i.started.started"
                  class="pk__started"
                >
                  Started:
                  <template v-if="i.started.status">status {{ i.started.status }}<template v-if="i.started.prs.length">, </template></template>
                  <a
                    v-for="(p, n) in i.started.prs"
                    :key="p.url"
                    :href="p.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ prText(p) }}{{ n < i.started.prs.length - 1 ? ', ' : '' }}</a>
                </span>
                <span
                  v-if="!i.started.started && i.started.possibly.length"
                  class="pk__possibly"
                  data-testid="pickup-possibly"
                  title="An open pull request in a UI repository mentions it without saying it fixes it: somebody may be on it"
                >
                  Possibly started:
                  <a
                    v-for="(p, n) in i.started.possibly"
                    :key="p.url"
                    :href="p.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ prText(p) }}, {{ whose(p) }}{{ n < i.started.possibly.length - 1 ? '; ' : '' }}</a>
                  mentions it
                </span>
                <span
                  v-if="!i.started.started && i.started.mentions.length"
                  class="pk__mention"
                >
                  Mentioned by
                  <a
                    v-for="(p, n) in i.started.mentions"
                    :key="p.url"
                    :href="p.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ prText(p) }}{{ n < i.started.mentions.length - 1 ? ', ' : '' }}</a>
                </span>
              </td>
              <td class="pk__nowrap">
                {{ i.status || '—' }}
              </td>
              <td class="pk__nowrap">
                {{ i.milestone || '—' }}
              </td>
              <td>{{ i.priority ? i.priority.replace(/^priority\//, 'P') : '—' }}</td>
              <td class="pk__people">
                {{ i.assignees.length ? i.assignees.join(', ') : '—' }}
              </td>
              <td class="pk__when">
                {{ when(i.updatedAt) }}
              </td>
              <td class="pk__actions">
                <button
                  type="button"
                  class="pk__btn"
                  :disabled="isStarting(i)"
                  data-testid="pickup-chat"
                  @click="chatButton(i)"
                >
                  {{ chatOf(i) ? 'Open chat' : (isStarting(i) ? 'Starting…' : 'Start chat') }}
                </button>
                <a
                  class="pk__btn pk__btn--primary"
                  :href="i.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="pickup-open-issue"
                >Open issue</a>
              </td>
            </tr>
          </tbody>
        </table>
        <p
          v-else-if="!loading && current"
          class="pk__none"
        >
          Nothing to pick up here{{ milestone !== '*' ? ` in ${ milestone || 'no milestone' }` : '' }}<template v-if="startedInMilestone">: {{ startedInMilestone === 1 ? 'its one issue is' : `all ${ startedInMilestone } of its issues are` }} started.
            <button
              type="button"
              class="pk__link"
              data-testid="pickup-show-them"
              @click="showStarted = true"
            >
              Show them
            </button>
          </template><template v-else>.</template>
        </p>
        <p
          v-else-if="loading && !answer"
          class="pk__none"
        >
          Asking GitHub for every tab…
        </p>
      </div>
    </section>
  </div>
</template>

<style lang="scss" scoped>
// Rancher's global `button` rule gives every button a 40px min-height and its own line-height:
// undone for this dialog's buttons, as the dashboard does for its own.
.pk button {
  min-height:  0;
  line-height: 1.4;
}

.pk {
  position:        fixed;
  inset:           0;
  z-index:         1000;
  display:         flex;
  align-items:     flex-start;
  justify-content: center;
  padding:         48px 24px;
  background:      rgba(21, 43, 39, 0.35);
}

.pk__dialog {
  display:        flex;
  flex-direction: column;
  width:          min(1240px, 100%);
  max-height:     calc(100vh - 96px);
  padding:        20px 24px 16px;
  border-radius:  12px;
  background:     var(--conv-surface, #fff);
  box-shadow:     0 12px 40px rgba(0, 0, 0, 0.2);
  color:          var(--conv-text);

  &:focus { outline: none; }
}

.pk__head {
  display:     flex;
  align-items: center;
  gap:         12px;
  margin-bottom: 12px;

  h2 {
    margin:      0;
    font-size:   18px;
    font-weight: 600;
  }
}

.pk__asked {
  flex:      1 1 auto;
  color:     var(--conv-meta);
  font-size: 12px;
}

.pk__close {
  display:       inline-flex;
  padding:       6px;
  border:        0;
  border-radius: 6px;
  background:    none;
  color:         var(--conv-muted);
  cursor:        pointer;

  &:hover { background: var(--conv-page); }
}

.pk__tabs {
  display:       flex;
  flex-wrap:     wrap;
  gap:           4px;
  border-bottom: 1px solid var(--conv-line);
}

.pk__tab {
  padding:       8px 14px;
  border:        0;
  border-bottom: 2px solid transparent;
  background:    none;
  color:         var(--conv-muted);
  cursor:        pointer;
  font-size:     13px;
  font-weight:   600;

  &--on {
    border-bottom-color: var(--conv-ink);
    color:               var(--conv-text);
  }
}

.pk__count {
  margin-left:   4px;
  padding:       1px 7px;
  border-radius: 10px;
  background:    var(--conv-subtle);
  font-size:     11px;
}

.pk__bar {
  display:     flex;
  flex-wrap:   wrap;
  align-items: center;
  gap:         16px;
  padding:     12px 0;
}

.pk__field {
  display:     inline-flex;
  align-items: center;
  gap:         8px;
  color:       var(--conv-muted);
  font-size:   12px;

  select {
    min-width:     180px;
    padding:       5px 8px;
    border:        1px solid var(--conv-line);
    border-radius: 6px;
    background:    var(--conv-surface);
    color:         var(--conv-text);
    font-size:     13px;
  }

  &--check { cursor: pointer; }
}

.pk__total {
  flex:      1 1 auto;
  color:     var(--conv-meta);
  font-size: 12px;
}

.pk__github {
  color:     var(--conv-link);
  font-size: 12px;
}

.pk__error,
.pk__note {
  margin:        0 0 8px;
  padding:       8px 12px;
  border-radius: 6px;
  font-size:     13px;
}

.pk__error {
  background: var(--conv-blocked-bg);
  color:      var(--conv-blocked);
}

.pk__note {
  background: var(--conv-subtle);
  color:      var(--conv-muted);
}

.pk__scroll {
  flex:       1 1 auto;
  min-height: 0;
  overflow:   auto;
}

.pk__table {
  width:           100%;
  border-collapse: collapse;
  font-size:       13px;

  th {
    position:       sticky;
    top:            0;
    z-index:        1;
    padding:        8px 10px;
    border-bottom:  1px solid var(--conv-line);
    background:     var(--conv-surface);
    color:          var(--conv-meta);
    font-size:      11px;
    font-weight:    600;
    letter-spacing: 0.04em;
    text-align:     left;
    text-transform: uppercase;
    white-space:    nowrap;
  }

  td {
    padding:        10px;
    border-bottom:  1px solid var(--conv-line);
    vertical-align: top;
  }
}

.pk__row {
  &--chat td {
    background: var(--conv-chat-bg);

    &:first-child { box-shadow: inset 4px 0 0 var(--conv-chat-edge); }
  }

  &--working td {
    background: var(--conv-working-bg);

    &:first-child { box-shadow: inset 4px 0 0 var(--conv-working); }
  }

  &--input td {
    background: var(--conv-waiting-bg);

    &:first-child { box-shadow: inset 4px 0 0 var(--conv-orange); }
  }

  &--started td { color: var(--conv-muted); }
}

.pk__issue {
  min-width: 360px;
}

.pk__title {
  display:     block;
  padding:     0;
  border:      0;
  background:  none;
  color:       var(--conv-text);
  cursor:      pointer;
  font-size:   14px;
  font-weight: 600;
  text-align:  left;
  white-space: normal;

  line-height: 1.35;

  &:hover { text-decoration: underline; }
  &:disabled { cursor: default; opacity: 0.6; }
}

.pk__nowrap { white-space: nowrap; }

.pk__meta {
  display:   flex;
  flex-wrap: wrap;
  gap:       4px 8px;
  margin-top: 3px;
  color:     var(--conv-meta);
  font-size: 12px;
}

.pk__label {
  padding:       0 6px;
  border-radius: 8px;
  background:    var(--conv-subtle);
  color:         var(--conv-muted);
  font-size:     11px;
}

.pk__started,
.pk__possibly,
.pk__mention {
  display:    block;
  margin-top: 4px;
  font-size:  12px;

  a { color: var(--conv-link); }
}

.pk__backport {
  display:    block;
  margin-top: 4px;
  color:      var(--conv-muted);
  font-size:  12px;

  a { color: var(--conv-link); }
}

.pk__started { color: var(--conv-muted); }
.pk__possibly { color: var(--conv-orange-text); }
.pk__mention { color: var(--conv-meta); font-style: italic; }

.pk__people,
.pk__when {
  color:       var(--conv-muted);
  white-space: nowrap;
}

.pk__actions {
  white-space: nowrap;
  text-align:  right;

  > * + * { margin-left: 6px; }
}

.pk__btn {
  display:         inline-flex;
  align-items:     center;
  padding:         5px 12px;
  border:          1px solid var(--conv-line);
  border-radius:   6px;
  background:      var(--conv-surface);
  color:           var(--conv-text);
  cursor:          pointer;
  font-size:       12px;
  text-decoration: none;

  &:disabled { opacity: 0.6; cursor: default; }

  &--primary {
    border-color: var(--conv-ink);
    background:   var(--conv-ink);
    color:        var(--conv-on-ink);
  }
}

.pk__link {
  padding:     0;
  border:      0;
  background:  none;
  color:       var(--conv-link);
  cursor:      pointer;
  font:        inherit;
}

.pk__none {
  padding:    24px 0;
  color:      var(--conv-meta);
  text-align: center;
}

.pk__sr {
  position: absolute;
  width:    1px;
  height:   1px;
  overflow: hidden;
  clip:     rect(0 0 0 0);
}
</style>
