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
    current:  { type: String, default: '' },
    loading:  { type: Boolean, default: false },
    creating: { type: Boolean, default: false },
  },

  data() {
    return {
      opened:     {}, renaming:   '', renameText: '', closing:    '',
    };
  },

  watch: {
    current: {
      immediate: true,
      handler(id) {
        if (id && !this.opened[id]) {
          this.opened = { ...this.opened, [id]: true };
        }
        this.closing = '';
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
          :session="chat.id"
          :mode="chat.cli || ''"
          :command="command(chat)"
        />
      </template>
    </main>
  </div>
</template>

<style lang="scss" scoped>
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
      border-bottom: 1px solid var(--border);
      overflow-x:    auto;
    }

    &__tab {
      display:       flex;
      align-items:   center;
      gap:           2px;
      border-bottom: 2px solid transparent;
      white-space:   nowrap;

      &--on {
        border-bottom-color: var(--conv-accent);

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
        background: var(--warning, #f5a623);
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
        background:  var(--conv-accent);
        color:       #fff;
        font-weight: 600;
      }
    }

    &__body {
      display:        flex;
      flex:           1 1 auto;
      flex-direction: column;
      min-height:     0;
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
