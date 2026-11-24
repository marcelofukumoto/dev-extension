<script>
// How many times you reviewed a pull request, as a number in a badge you see at a glance, then
// what the last one said: "[2] reviews by you · last changes requested 1h ago". Fed by
// conversation-api's `rounds` (server/github.mjs, myRounds: what you posted, thread replies left
// out); draws nothing when there is no count - a page that asked GitHub itself has none.
import { roundsSummary, roundsTitle } from './projects.mjs';

export default {
  name: 'ReviewRounds',

  props: {
    rounds: { type: Array, default: undefined },
    /** The clock "1h ago" is read against, so a page that ticks keeps it current. */
    now:    { type: Number, default: 0 },
  },

  computed: {
    summary() {
      return roundsSummary(this.rounds, this.now || Date.now());
    },

    title() {
      return roundsTitle(this.rounds);
    },
  },
};
</script>

<template>
  <span
    v-if="summary"
    class="rr"
    :title="title || null"
    data-testid="review-rounds"
  >
    <span
      class="rr__count"
      :class="{ 'rr__count--none': !summary.count }"
      data-testid="review-rounds-count"
    >{{ summary.count }}</span>
    <span class="rr__label">{{ summary.count === 1 ? 'review' : 'reviews' }} by you</span>
    <span
      v-if="summary.last"
      class="rr__last"
    >· last {{ summary.last }}</span>
  </span>
</template>

<style lang="scss" scoped>
.rr {
  display:     inline-flex;
  flex-wrap:   wrap;
  align-items: center;
  gap:         2px 6px;
  font-size:   12px;
}

.rr__count {
  display:         inline-flex;
  align-items:     center;
  justify-content: center;
  min-width:       22px;
  height:          20px;
  padding:         0 7px;
  border-radius:   10px;
  background:      var(--conv-ink, #152b27);
  color:           var(--conv-on-ink, #ffffff);
  font-size:       12px;
  font-weight:     700;
  line-height:     1;

  // Not reviewed yet: there, but quiet.
  &--none {
    background: var(--conv-subtle, #edf0ee);
    box-shadow: inset 0 0 0 1px var(--conv-line, #d8ddda);
    color:      var(--conv-muted, #5c6560);
  }
}

.rr__label {
  color:       var(--conv-text, #152b27);
  font-weight: 600;
}

.rr__last {
  color: var(--conv-muted, #5c6560);
}
</style>
