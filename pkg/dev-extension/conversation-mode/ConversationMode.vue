<script>
// Conversation mode: one chat at a time, the others as tabs.
//
// Everything a conversation is - the registry, the pane, the transcript, the chat drawn from it -
// is the Dev product's own (conversations.ts, StudioTerminal, ChatPane). This page only decides
// which conversations are on it and what each one's pane runs: the interrupt-duty repo as its
// working directory and conv-shell as its tunnel (see config.mjs). Started from here once, a
// pane keeps that argv for good, because shell.sh records it and replays it after a restart.
//
// The tab is the hash, as on a workspace's page, so a reload or a link lands on the same chat.
import StudioTerminal from '../components/StudioTerminal.vue';
import AppIcon from '../components/focus/AppIcon.vue';
import {
  listConversations, startConversation, renameConversation, endConversation, conversationStates
} from '../conversations';
import { agentStateOf } from '../workspace-status';
import {
  DEV_PRODUCT, BLANK_CLUSTER, WORKSPACES_ROUTE, FOCUS_ROUTE
} from '../config/constants';
import { CONVERSATION_WORKSPACE, chatCommand, nextChatTitle } from './config.mjs';

/** How often the tabs' dots are refreshed: what each conversation is doing. */
const STATE_POLL_MS = 5000;

/** What each agent state reads as, on a tab's dot. */
const STATE_LABEL = {
  working: 'Working', input: 'Waiting for you', idle: 'Idle', finished: 'Done', none: 'Not running'
};

export default {
  name: 'ConversationMode',

  components: { StudioTerminal, AppIcon },

  data() {
    return {
      chats:      [],
      current:    '',
      /** Chats whose pane has been opened on this page: kept mounted, so switching back is instant. */
      opened:     {},
      /** What each chat's agent is doing, from the shared state poll. */
      activity:   {},
      loading:    true,
      creating:   false,
      error:      '',
      renaming:   '',
      renameText: '',
      closing:    '',
    };
  },

  async mounted() {
    await this.load();
    this.poll = setInterval(() => this.refreshStates(), STATE_POLL_MS);
    this.refreshStates();
  },

  beforeUnmount() {
    clearInterval(this.poll);
  },

  computed: {
    devTo() {
      return { name: WORKSPACES_ROUTE, params: { product: DEV_PRODUCT, cluster: BLANK_CLUSTER } };
    },

    focusTo() {
      return { name: FOCUS_ROUTE, params: { product: DEV_PRODUCT, cluster: BLANK_CLUSTER } };
    },

    currentChat() {
      return this.chats.find((c) => c.id === this.current) || null;
    },
  },

  watch: {
    '$route.hash'(hash) {
      const id = (hash || '').replace(/^#/, '');

      if (id && id !== this.current && this.chats.some((c) => c.id === id)) {
        this.select(id, false);
      }
    },
  },

  methods: {
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const list = await listConversations(CONVERSATION_WORKSPACE);

        this.chats = list.map((c) => ({ id: c.id, title: c.title, cli: c.cli || '' }));
        const wanted = (this.$route.hash || '').replace(/^#/, '');
        const first = this.chats.find((c) => c.id === wanted) || this.chats[0];

        if (first) {
          this.select(first.id, !wanted);
        }
      } catch (e) {
        this.error = `The chats could not be listed: ${ e?.message || e }`;
      } finally {
        this.loading = false;
      }
    },

    command(chat) {
      return chatCommand(chat.id, chat.cli);
    },

    select(id, writeHash = true) {
      this.current = id;
      this.opened = { ...this.opened, [id]: true };
      this.closing = '';
      if (writeHash && this.$route.hash !== `#${ id }`) {
        this.$router.replace({ ...this.$route, hash: `#${ id }` }).catch(() => {});
      }
    },

    async create() {
      if (this.creating) {
        return;
      }
      this.creating = true;
      this.error = '';
      try {
        const title = nextChatTitle(this.chats.map((c) => c.title));
        const made = await startConversation(CONVERSATION_WORKSPACE, title);

        this.chats.push({ id: made.id, title: made.title || title, cli: '' });
        this.select(made.id);
      } catch (e) {
        this.error = `A new chat could not be started: ${ e?.message || e }`;
      } finally {
        this.creating = false;
      }
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

    async finishRename() {
      const id = this.renaming;
      const title = this.renameText.trim();
      const chat = this.chats.find((c) => c.id === id);

      this.renaming = '';
      if (!chat || !title || title === chat.title) {
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

    async close(id) {
      this.closing = '';
      this.error = '';
      try {
        await endConversation(CONVERSATION_WORKSPACE, id);
        const at = this.chats.findIndex((c) => c.id === id);

        this.chats = this.chats.filter((c) => c.id !== id);
        const opened = { ...this.opened };

        delete opened[id];
        this.opened = opened;
        if (this.current === id) {
          const next = this.chats[Math.min(at, this.chats.length - 1)];

          if (next) {
            this.select(next.id);
          } else {
            this.current = '';
            this.$router.replace({ ...this.$route, hash: '' }).catch(() => {});
          }
        }
      } catch (e) {
        this.error = `The chat could not be closed: ${ e?.message || e }`;
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
      this.activity = activity;
    },

    stateOf(id) {
      return this.activity[id] || 'none';
    },

    stateLabel(id) {
      return STATE_LABEL[this.stateOf(id)] || '';
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
        <span
          class="conv__mode conv__mode--on"
          aria-current="page"
        >Conversation</span>
      </nav>
      <div class="conv__spacer" />
      <button
        type="button"
        class="conv__back"
        data-testid="conversation-back-to-rancher"
        @click="toRancher"
      >
        <i class="icon icon-chevron-left" /> Back to Rancher
      </button>
    </header>

    <div
      class="conv__tabs"
      role="tablist"
      aria-label="Chats"
    >
      <div
        v-for="chat in chats"
        :key="chat.id"
        class="conv__tab"
        :class="{ 'conv__tab--on': chat.id === current }"
      >
        <input
          v-if="renaming === chat.id"
          ref="renameInput"
          v-model="renameText"
          class="conv__rename"
          aria-label="Chat name"
          @keydown.enter.prevent="finishRename"
          @keydown.esc.prevent="renaming = ''"
          @blur="finishRename"
        >
        <button
          v-else
          type="button"
          role="tab"
          class="conv__tab-button"
          :aria-selected="chat.id === current ? 'true' : 'false'"
          :title="`${ stateLabel(chat.id) } - double-click to rename`"
          :data-testid="`conversation-tab-${ chat.id }`"
          @click="select(chat.id)"
          @dblclick="startRename(chat)"
        >
          <span
            class="conv__dot"
            :class="`conv__dot--${ stateOf(chat.id) }`"
            :aria-label="stateLabel(chat.id)"
          />
          <span class="conv__title">{{ chat.title }}</span>
        </button>
        <template v-if="closing === chat.id">
          <span class="conv__confirm">Close?</span>
          <button
            type="button"
            class="conv__confirm-yes"
            :data-testid="`conversation-close-yes-${ chat.id }`"
            @click="close(chat.id)"
          >
            Yes
          </button>
          <button
            type="button"
            class="conv__confirm-no"
            @click="closing = ''"
          >
            No
          </button>
        </template>
        <button
          v-else-if="renaming !== chat.id"
          type="button"
          class="conv__close"
          :aria-label="`Close ${ chat.title }`"
          :data-testid="`conversation-close-${ chat.id }`"
          @click="closing = chat.id"
        >
          <i class="icon icon-close" />
        </button>
      </div>
      <button
        type="button"
        class="conv__new"
        :disabled="creating"
        data-testid="conversation-new"
        @click="create"
      >
        <AppIcon
          :name="creating ? 'spinner' : 'plus'"
          :size="14"
        />
        New chat
      </button>
    </div>

    <p
      v-if="error"
      class="conv__error"
      role="alert"
    >
      {{ error }}
    </p>

    <main class="conv__body">
      <p
        v-if="loading"
        class="conv__empty"
      >
        Loading your chats…
      </p>
      <div
        v-else-if="!chats.length"
        class="conv__empty"
      >
        <p>No chats yet. Each one works in the interrupt-duty repo, with its memory and tools.</p>
        <button
          type="button"
          class="conv__new conv__new--big"
          :disabled="creating"
          @click="create"
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
          class="conv__pane"
          :session="chat.id"
          :mode="chat.cli || ''"
          :command="command(chat)"
        />
      </template>
    </main>
  </div>
</template>

<style lang="scss" scoped>
  // The mockup's green, kept to accents so the page reads in Rancher's light and dark themes.
  .conv {
    --conv-accent: #30ba78;
    --conv-accent-text: #1a7a4c;

    display:        flex;
    flex-direction: column;
    height:         100vh;
    min-height:     0;
    background:     var(--body-bg);
    color:          var(--body-text);

    &__top {
      display:       flex;
      align-items:   center;
      gap:           16px;
      padding:       10px 16px;
      border-bottom: 1px solid var(--border);
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
      color:           #fff;
    }

    &__modes {
      display: flex;
      gap:     4px;
    }

    &__mode {
      padding:         4px 10px;
      border-radius:   14px;
      color:           var(--body-text);
      text-decoration: none;
      font-size:       13px;

      &:hover {
        background: var(--accent-btn, rgba(127, 127, 127, 0.12));
      }

      &--on {
        background:  var(--conv-accent);
        color:       #fff;
        font-weight: 600;

        &:hover {
          background: var(--conv-accent);
        }
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

        .conv__title {
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
      max-width:     220px;
      overflow:      hidden;
      text-overflow: ellipsis;
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
        animation:  conv-pulse 1.4s ease-in-out infinite;
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
      width:     180px;
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
        margin:     12px 0 0;
        padding:    8px 16px;
        border:     0;
        background: var(--conv-accent);
        color:      #fff;
        font-weight: 600;
      }
    }

    &__error {
      margin:     8px 16px 0;
      padding:    8px 12px;
      border-radius: 6px;
      background: rgba(214, 69, 69, 0.12);
      color:      var(--error, #d64545);
      font-size:  13px;
    }

    &__body {
      position:       relative;
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

  @keyframes conv-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
</style>
