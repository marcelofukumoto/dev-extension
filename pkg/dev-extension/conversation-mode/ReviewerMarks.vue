<script>
// Who reviews a pull request and where each stands, with GitHub's own marks, so the row says it
// without opening the page: a red diff for changes requested, a green check for approved, a yellow
// dot for asked and not answered yet, a grey bubble for comments only. Fed by conversation-api's
// `reviewers` (server/github.mjs, reviewersOf); draws nothing when there are none.
const STATE = {
  changes:   { label: 'requested changes', path: 'M1 1.75C1 .784 1.784 0 2.75 0h7.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073ZM8 3.25a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0V7h-1.5a.75.75 0 0 1 0-1.5h1.5V4A.75.75 0 0 1 8 3.25Zm-3 8a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z' },
  approved:  { label: 'approved', path: 'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z' },
  commented: { label: 'commented', path: 'M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z' },
  pending:   { label: 'review requested, not given yet', path: '' },
};

export default {
  name: 'ReviewerMarks',

  props: {
    reviewers: { type: Array, default: () => [] },
    /** Your login: you are "you". */
    me:        { type: String, default: '' },
    max:       { type: Number, default: 4 },
  },

  computed: {
    shown() {
      return this.reviewers.slice(0, this.max).map((r) => ({
        ...r,
        name: r.login === this.me ? 'you' : r.login.replace(/^team:/, '@'),
        ...(STATE[r.state] || STATE.commented),
      }));
    },

    more() {
      return Math.max(0, this.reviewers.length - this.max);
    },

    summary() {
      return this.reviewers.map((r) => `${ r.login === this.me ? 'you' : r.login.replace(/^team:/, '@') }: ${ (STATE[r.state] || STATE.commented).label }`).join(', ');
    },
  },
};
</script>

<template>
  <span
    v-if="reviewers.length"
    class="rm"
    :title="summary"
    :aria-label="`Reviewers: ${ summary }`"
    data-testid="reviewer-marks"
  >
    <span
      v-for="r in shown"
      :key="r.login"
      class="rm__one"
      :class="`rm__one--${ r.state }`"
    >
      <svg
        v-if="r.path"
        class="rm__icon"
        viewBox="0 0 16 16"
        aria-hidden="true"
      ><path :d="r.path" /></svg>
      <span
        v-else
        class="rm__dot"
        aria-hidden="true"
      />
      {{ r.name }}
    </span>
    <span
      v-if="more"
      class="rm__more"
    >+{{ more }}</span>
  </span>
</template>

<style lang="scss" scoped>
.rm {
  display:     inline-flex;
  flex-wrap:   wrap;
  align-items: center;
  gap:         2px 10px;
  font-size:   12px;
}

.rm__one {
  display:     inline-flex;
  align-items: center;
  gap:         3px;
  color:       var(--conv-muted, #6b7280);
  white-space: nowrap;

  &--changes .rm__icon { fill: #cf222e; }
  &--approved .rm__icon { fill: #1a7f37; }
  &--commented .rm__icon { fill: currentColor; }
}

.rm__icon {
  width:  12px;
  height: 12px;
}

.rm__dot {
  width:         8px;
  height:        8px;
  margin:        0 2px;
  border-radius: 50%;
  background:    #bf8700;
}

.rm__more {
  color: var(--conv-muted, #6b7280);
}
</style>
