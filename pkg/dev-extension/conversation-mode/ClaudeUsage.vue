<script>
// How much of the Claude plan is gone: the five-hour session and the week, as two bars. The same
// numbers Cody's sidebar draws its CLAUDE bar from - dev-api's `/system/usage`, on the page's
// shared watch (events.ts), which dev-api refreshes from Anthropic at most every five minutes -
// with the session as a bar of its own rather than only in the hover, since that is the limit a
// long chat runs into first. Draws nothing until there is an answer.
import { watch } from '../events';

const WARN = 80;

export default {
  name: 'ClaudeUsage',

  data() {
    return { usage: null };
  },

  mounted() {
    this.stop = watch('/system/usage', (seen) => {
      this.usage = seen || null;
    }, { every: 60000 });
  },

  beforeUnmount() {
    this.stop?.();
  },

  computed: {
    claude() {
      return this.usage?.claude || null;
    },

    bars() {
      const c = this.claude;

      if (!c) {
        return [];
      }
      const at = (iso, how) => {
        const when = iso ? new Date(iso) : null;

        return when && !Number.isNaN(when.getTime()) ? when.toLocaleString([], how) : '';
      };
      const old = c.staleSince ? ` · as of ${ at(c.staleSince, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) }, since ${ c.error || 'it could not be read' }` : '';
      const out = [];

      if (c.session) {
        const resets = at(c.session.resetsAt, { hour: 'numeric', minute: '2-digit' });

        out.push({
          id:      'session',
          label:   '5H',
          percent: c.session.percent,
          value:   `${ c.session.percent }%${ resets ? ` · ${ resets }` : '' }`,
          title:   `Claude${ c.plan ? ` (${ c.plan })` : '' }: ${ c.session.percent }% of the five-hour session used${ resets ? `, resets at ${ resets }` : '' }${ old }`,
        });
      }
      if (c.week) {
        const resets = at(c.week.resetsAt, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
        const models = [c.opus && `Opus week ${ c.opus.percent }%`, c.sonnet && `Sonnet week ${ c.sonnet.percent }%`].filter(Boolean);

        out.push({
          id:      'week',
          label:   'WK',
          percent: c.week.percent,
          value:   `${ c.week.percent }% wk`,
          title:   `Claude${ c.plan ? ` (${ c.plan })` : '' }: ${ c.week.percent }% of this week's limit used${ resets ? `, resets ${ resets }` : '' }${ models.length ? ` · ${ models.join(' · ') }` : '' }${ old }`,
        });
      }

      return out;
    },
  },

  methods: {
    warn: (percent) => percent > WARN,
  },
};
</script>

<template>
  <div
    v-if="bars.length"
    class="usage"
    data-testid="claude-usage"
  >
    <span class="usage__name">Claude</span>
    <div
      v-for="bar in bars"
      :key="bar.id"
      class="usage__bar"
      :title="bar.title"
      :data-testid="`claude-usage-${ bar.id }`"
    >
      <span class="usage__label">{{ bar.label }}</span>
      <span
        class="usage__track"
        role="progressbar"
        :aria-label="bar.title"
        :aria-valuenow="bar.percent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span
          class="usage__fill"
          :class="{ 'usage__fill--warn': warn(bar.percent) }"
          :style="{ width: `${ Math.min(100, bar.percent) }%` }"
        />
      </span>
      <span class="usage__value">{{ bar.value }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.usage {
  display:        flex;
  flex-direction: column;
  gap:            4px;
}

.usage__name {
  color:          var(--conv-muted, #6b7280);
  font-size:      11px;
  font-weight:    600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.usage__bar {
  display:     flex;
  align-items: center;
  gap:         8px;
}

.usage__label {
  flex:        0 0 22px;
  color:       var(--conv-muted, #6b7280);
  font-family: monospace;
  font-size:   11px;
}

.usage__track {
  flex:          1 1 auto;
  min-width:     60px;
  height:        6px;
  overflow:      hidden;
  border-radius: 3px;
  background:    var(--conv-line, #e5e7eb);
}

.usage__fill {
  display:    block;
  height:     100%;
  background: var(--conv-accent, #4cae6b);
  transition: width 0.6s ease;

  &--warn { background: var(--conv-orange, #e8833a); }
}

.usage__value {
  flex:                 0 0 auto;
  min-width:            74px;
  font-size:            11px;
  font-variant-numeric: tabular-nums;
  text-align:           right;
}
</style>
