<script>
// Conversation mode's chats: a tab per chat and the chat itself.
//
// The list, what each agent is doing and which chat is current belong to the page around this
// (ConversationMode.vue), because the dashboard reads the same ones. This draws them and says what
// was asked: select, create, rename, close. A chat's pane is mounted the first time it is current
// and kept, so going back to a tab - or to the dashboard and back - is instant and keeps the
// socket.
import StudioTerminal from '../components/StudioTerminal.vue';
import AppIcon from '../components/focus/AppIcon.vue';
import { chatCommand } from './config.mjs';
import { shortRef } from './projects.mjs';

/** Chips in the links bar before "+N more". */
const LINKS_SHOWN = 8;

/** What a chip says it is, before its label. */
const LINK_KIND = {
  preview: 'Preview', page: 'Page', pr: 'PR', issue: 'Issue', ci: 'CI', env: 'Rancher', jira: 'Jira', doc: 'Docs', other: ''
};

const STATE_LABEL = {
  working: 'Working', input: 'Waiting for you', idle: 'Idle', finished: 'Done', none: 'Not running'
};

export default {
  name: 'ConversationChats',

  components: { StudioTerminal, AppIcon },

  emits: ['select', 'create', 'rename', 'close'],

  props: {
    chats:    { type: Array, default: () => [] },
    activity: { type: Object, default: () => ({}) },
    links:    { type: Object, default: () => ({}) },
    /** chat id -> its links as chips (linkify.mjs, chatLinks), from the page around this. */
    chatLinks: { type: Object, default: () => ({}) },
    current:  { type: String, default: '' },
    loading:  { type: Boolean, default: false },
    creating: { type: Boolean, default: false },
  },

  data() {
    return {
      opened:     {}, renaming:   '', renameText: '', closing:    '', linksAll:   false,
    };
  },

  computed: {
    LINKS_SHOWN: () => LINKS_SHOWN,

    currentLinks() {
      return this.chatLinks[this.current] || [];
    },

    shownLinks() {
      return this.linksAll ? this.currentLinks : this.currentLinks.slice(0, LINKS_SHOWN);
    },
  },

  watch: {
    current: {
      immediate: true,
      handler(id) {
        if (id && !this.opened[id]) {
          this.opened = { ...this.opened, [id]: true };
        }
        this.closing = '';
        this.linksAll = false;
      },
    },

    chats(list) {
      // A closed chat's pane goes with it.
      const ids = new Set(list.map((c) => c.id));
      const opened = {};

      for (const id of Object.keys(this.opened)) {
        if (ids.has(id)) {
          opened[id] = true;
        }
      }
      this.opened = opened;
    },
  },

  methods: {
    command(chat) {
      return chatCommand(chat.id, chat.cli);
    },

    stateOf(id) {
      return this.activity[id] || 'none';
    },

    /** "PR", "Preview", … - the subject chip says what the subject is (a PR or an issue). */
    linkKind(link) {
      return link.kind === 'subject' ? (link.sub === 'issue' ? 'Issue' : 'PR') : LINK_KIND[link.kind] || '';
    },

    stateLabel(id) {
      return STATE_LABEL[this.stateOf(id)] || '';
    },

    subjectRef(id) {
      const s = this.links[id]?.subject;

      return s ? shortRef(s.repo, s.number) : '';
    },

    startRename(chat) {
      this.renaming = chat.id;
      this.renameText = chat.title;
      this.$nextTick(() => {
        const input = this.$refs.renameInput;
        const el = Array.isArray(input) ? input[0] : input;

        el?.focus();
        el?.select();
      });
    },

    finishRename() {
      const id = this.renaming;
      const title = this.renameText.trim();

      this.renaming = '';
      if (id && title) {
        this.$emit('rename', { id, title });
      }
    },
  },
};
</script>

<template>
  <div class="chats">
    <div
      class="chats__tabs"
      role="tablist"
      aria-label="Chats"
    >
      <div
        v-for="chat in chats"
        :key="chat.id"
        class="chats__tab"
        :class="{ 'chats__tab--on': chat.id === current }"
      >
        <input
          v-if="renaming === chat.id"
          ref="renameInput"
          v-model="renameText"
          class="chats__rename"
          aria-label="Chat name"
          @keydown.enter.prevent="finishRename"
          @keydown.esc.prevent="renaming = ''"
          @blur="finishRename"
        >
        <button
          v-else
          type="button"
          role="tab"
          class="chats__tab-button"
          :aria-selected="chat.id === current ? 'true' : 'false'"
          :title="`${ stateLabel(chat.id) } - double-click to rename`"
          :data-testid="`conversation-tab-${ chat.id }`"
          @click="$emit('select', chat.id)"
          @dblclick="startRename(chat)"
        >
          <span
            class="chats__dot"
            :class="`chats__dot--${ stateOf(chat.id) }`"
            :aria-label="stateLabel(chat.id)"
          />
          <span class="chats__title">{{ chat.title }}</span>
          <span
            v-if="subjectRef(chat.id) && !chat.title.startsWith(subjectRef(chat.id))"
            class="chats__ref"
          >{{ subjectRef(chat.id) }}</span>
        </button>
        <template v-if="closing === chat.id">
          <span class="chats__confirm">Close?</span>
          <button
            type="button"
            class="chats__confirm-yes"
            :data-testid="`conversation-close-yes-${ chat.id }`"
            @click="closing = ''; $emit('close', chat.id)"
          >
            Yes
          </button>
          <button
            type="button"
            class="chats__confirm-no"
            @click="closing = ''"
          >
            No
          </button>
        </template>
        <button
          v-else-if="renaming !== chat.id"
          type="button"
          class="chats__close"
          :aria-label="`Close ${ chat.title }`"
          :data-testid="`conversation-close-${ chat.id }`"
          @click="closing = chat.id"
        >
          <i class="icon icon-close" />
        </button>
      </div>
      <button
        type="button"
        class="chats__new"
        :disabled="creating"
        data-testid="conversation-new"
        @click="$emit('create')"
      >
        <AppIcon
          :name="creating ? 'spinner' : 'plus'"
          :size="14"
        />
        New chat
      </button>
    </div>

    <nav
      v-if="currentLinks.length"
      class="chats__links"
      aria-label="Links in this chat"
      data-testid="chat-links"
    >
      <a
        v-for="link in shownLinks"
        :key="link.key"
        class="chats__link"
        :class="`chats__link--${ link.kind }`"
        :href="link.url"
        :title="link.url"
        target="_blank"
        rel="noopener noreferrer"
      ><span
        v-if="linkKind(link)"
        class="chats__link-kind"
      >{{ linkKind(link) }}</span>{{ link.label }}</a>
      <button
        v-if="currentLinks.length > LINKS_SHOWN"
        type="button"
        class="chats__link-more"
        @click="linksAll = !linksAll"
      >
        {{ linksAll ? 'Fewer' : `+${ currentLinks.length - LINKS_SHOWN } more` }}
      </button>
    </nav>

    <main class="chats__body">
      <p
        v-if="loading"
        class="chats__empty"
      >
        Loading your chats…
      </p>
      <div
        v-else-if="!chats.length"
        class="chats__empty"
      >
        <p>No chats yet. Each one works in the interrupt-duty repo, with its memory and tools.</p>
        <button
          type="button"
          class="chats__new chats__new--big"
          :disabled="creating"
          @click="$emit('create')"
        >
          <AppIcon
            :name="creating ? 'spinner' : 'plus'"
            :size="14"
          />
          Start a chat
        </button>
      </div>
      <template
        v-for="chat in chats"
        :key="chat.id"
      >
        <StudioTerminal
          v-if="opened[chat.id]"
          v-show="chat.id === current"
          class="chats__pane"
          skin="conversation"
          :session="chat.id"
          :mode="chat.cli || ''"
          :command="command(chat)"
        />
      </template>
    </main>
  </div>
</template>

<style lang="scss" scoped>

  // Rancher's global `button` rule gives every button a 40px min-height and its own line-height;
  // these are compact, and only this component's own buttons are touched (scoped), never the
  // chat's.
  .chats button {
    min-height:  0;
    line-height: 1.4;
  }
  .chats {
    display:        flex;
    flex:           1 1 auto;
    flex-direction: column;
    min-height:     0;

    &__tabs {
      display:       flex;
      align-items:   stretch;
      gap:           2px;
      padding:       0 12px;
      border-bottom: 1px solid var(--conv-line);
      background:    var(--conv-surface);
      overflow-x:    auto;
    }

    &__tab {
      display:       flex;
      align-items:   center;
      gap:           2px;
      border-bottom: 2px solid transparent;
      white-space:   nowrap;

      &--on {
        border-bottom-color: var(--conv-ink);

        .chats__title {
          font-weight: 600;
        }
      }
    }

    &__tab-button {
      display:     flex;
      align-items: center;
      gap:         8px;
      padding:     10px 6px 10px 10px;
      border:      0;
      background:  none;
      color:       var(--body-text);
      cursor:      pointer;
      font-size:   13px;
    }

    &__title {
      max-width:     240px;
      overflow:      hidden;
      text-overflow: ellipsis;
    }

    &__ref {
      font-size: 11px;
      color:     var(--muted, #999);
    }

    &__dot {
      flex:          0 0 auto;
      width:         8px;
      height:        8px;
      border-radius: 50%;
      background:    var(--muted, #999);
      opacity:       0.5;

      &--working {
        background: var(--conv-accent);
        opacity:    1;
        animation:  chats-pulse 1.4s ease-in-out infinite;
      }

      &--input {
        background: var(--conv-orange);
        opacity:    1;
      }

      &--idle,
      &--finished {
        background: var(--conv-accent);
        opacity:    0.6;
      }
    }

    &__rename {
      margin:    6px;
      padding:   4px 6px;
      font-size: 13px;
      width:     200px;
    }

    &__close,
    &__confirm-yes,
    &__confirm-no {
      border:     0;
      background: none;
      color:      var(--muted, #999);
      cursor:     pointer;
      padding:    4px;
      font-size:  12px;

      &:hover {
        color: var(--body-text);
      }
    }

    &__confirm {
      font-size: 12px;
      color:     var(--muted, #999);
    }

    &__confirm-yes {
      color: var(--error, #d64545);
    }

    &__new {
      display:       flex;
      align-items:   center;
      gap:           6px;
      margin:        6px 0 6px 8px;
      padding:       4px 12px;
      border:        1px solid var(--border);
      border-radius: 6px;
      background:    none;
      color:         var(--body-text);
      cursor:        pointer;
      font-size:     13px;
      white-space:   nowrap;

      &:disabled {
        opacity: 0.6;
        cursor:  default;
      }

      &--big {
        margin:      12px 0 0;
        padding:     8px 16px;
        border:      0;
        background:  var(--conv-ink);
        color:       var(--conv-on-ink);
        font-weight: 600;
      }
    }

    // The chat's links: what it is about first (ink), then previews (mint), pages and pull requests
    // (the mockup's review blue), CI (its question peach), the rest plain.
    &__links {
      display:       flex;
      flex-wrap:     wrap;
      align-items:   center;
      gap:           6px;
      padding:       8px 16px;
      border-bottom: 1px solid var(--conv-line);
      background:    var(--conv-surface);
    }

    &__link {
      display:         inline-flex;
      align-items:     center;
      gap:             6px;
      max-width:       320px;
      padding:         3px 10px;
      overflow:        hidden;
      border:          1px solid var(--conv-line);
      border-radius:   14px;
      background:      var(--conv-surface);
      color:           var(--conv-text);
      font-size:       12px;
      text-decoration: none;
      text-overflow:   ellipsis;
      white-space:     nowrap;

      &:hover { border-color: var(--conv-ink); }

      &--subject {
        border-color: var(--conv-ink);
        background:   var(--conv-ink);
        color:        var(--conv-on-ink);

        .chats__link-kind { color: var(--conv-mint); }
      }

      &--preview { border-color: var(--conv-mint-line); background: var(--conv-mint); }
      &--page,
      &--pr,
      &--issue { border-color: transparent; background: var(--conv-review-bg); color: var(--conv-review); }
      &--ci { border-color: transparent; background: var(--conv-question-bg); color: var(--conv-question); }
      &--jira { border-color: transparent; background: var(--conv-blocked-bg); color: var(--conv-blocked); }
    }

    &__link-kind {
      font-size:      10px;
      font-weight:    600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      opacity:        0.8;
    }

    &__link-more {
      padding:    2px 6px;
      border:     0;
      background: none;
      color:      var(--conv-link);
      cursor:     pointer;
      font-size:  12px;
    }

    &__body {
      display:        flex;
      flex:           1 1 auto;
      flex-direction: column;
      min-height:     0;
      background:     var(--conv-page);
    }

    &__pane {
      flex:       1 1 auto;
      min-height: 0;
    }

    &__empty {
      margin:     auto;
      text-align: center;
      color:      var(--muted, #999);
    }
  }

  @keyframes chats-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
</style>

<style lang="scss">
  // The chat's skin for Conversation mode (ChatPane's `skin` prop puts `mc-chat--skin-conversation`
  // on its root). ChatPane's own rules are scoped - a class and an attribute - so these carry one
  // class more to win, and they only reach a chat inside this page. Colours come from the tokens on
  // `.conv` (ConversationMode.vue): the messages sit on the grey page as the mockup's cards do -
  // yours in the mint of its "My tasks" panel, Claude's in white - and the send button is the ink of
  // its primary buttons rather than the link blue.
  .conv .mc-chat.mc-chat--skin-conversation {
    background: var(--conv-page);

    .mc-chat__msg--user {
      background:   var(--conv-mint);
      border-color: var(--conv-mint-line);
    }

    .mc-chat__msg--assistant {
      background:   var(--conv-surface);
      border-color: var(--conv-line);
    }

    .mc-chat__msg--queued {
      background:   var(--conv-surface);
      border-color: var(--conv-accent);
    }

    .mc-chat__who {
      color:       var(--conv-ink);
      font-weight: 600;
    }

    .mc-chat__box {
      border-color:  var(--conv-line);
      border-radius: 12px;
      background:    var(--conv-surface);

      &:focus-within {
        border-color: var(--conv-ink);
      }
    }

    .mc-chat__send {
      background: var(--conv-ink);
      color:      var(--conv-on-ink);

      &:disabled {
        background: var(--conv-subtle);
        color:      var(--conv-meta);
      }
    }
  }
</style>
