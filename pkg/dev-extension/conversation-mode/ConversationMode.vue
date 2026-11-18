<script>
// Conversation mode: a dashboard of what is going on, and the chats that act on it.
//
// Two views under one route, `/dev/c/_/conversation/:view?` - the dashboard (no view) and the
// chats (`chat`, with the chat as the hash). This page owns what both of them read: the chats,
// what each agent is doing, and which chat is about which pull request (links.ts). The chats view
// is mounted the first time it is shown and then kept, so its panes - and their sockets - live
// through a trip to the dashboard and back.
//
// Everything a conversation is (the registry, the pane, the transcript, the chat drawn from it) is
// the Dev product's own; config.mjs says how ours differ: the interrupt-duty repo as the working
// directory and conv-shell as the tunnel.
import AppIcon from '../components/focus/AppIcon.vue';
import ConversationChats from './ConversationChats.vue';
import ConversationDashboard from './ConversationDashboard.vue';
import {
  listConversations, startConversation, renameConversation, endConversation, conversationStates
} from '../conversations';
import { agentStateOf } from '../workspace-status';
import {
  DEV_PRODUCT, BLANK_CLUSTER, WORKSPACES_ROUTE, FOCUS_ROUTE
} from '../config/constants';
import { CONVERSATION_ROUTE } from './routes';
import { CONVERSATION_WORKSPACE, nextChatTitle } from './config.mjs';
import { subjectKey, chatTitleFor, openingMessage } from './projects.mjs';
import { readLinks, updateLinks } from './links';

/** How often what each agent is doing is asked again. */
const STATE_POLL_MS = 5000;

export default {
  name: 'ConversationMode',

  components: { AppIcon, ConversationChats, ConversationDashboard },

  data() {
    return {
      chats:        [],
      activity:     {},
      links:        {},
      loadingChats: true,
      creating:     false,
      /** The subject a chat is being started for, so its button says so. */
      starting:     '',
      error:        '',
      /** Whether the chats view has been shown yet: it is mounted then and kept. */
      chatsShown:   false,
    };
  },

  async mounted() {
    await Promise.all([this.loadChats(), this.loadLinks()]);
    this.poll = setInterval(() => this.refreshStates(), STATE_POLL_MS);
    this.refreshStates();
  },

  beforeUnmount() {
    clearInterval(this.poll);
  },

  computed: {
    view() {
      return this.$route.params.view === 'chat' ? 'chat' : 'dashboard';
    },

    current() {
      const id = (this.$route.hash || '').replace(/^#/, '');

      return this.chats.some((c) => c.id === id) ? id : '';
    },

    devTo() {
      return { name: WORKSPACES_ROUTE, params: { product: DEV_PRODUCT, cluster: BLANK_CLUSTER } };
    },

    focusTo() {
      return { name: FOCUS_ROUTE, params: { product: DEV_PRODUCT, cluster: BLANK_CLUSTER } };
    },

    principal() {
      return this.$store.getters['rancher/byId']('principal', this.$store.getters['auth/principalId']) || {};
    },

    /** The first name, the way the mockup greets: "Good evening, Marcelo". */
    firstName() {
      const name = this.principal.name || this.principal.loginName || '';

      return name.split(/\s+/)[0] || '';
    },

    waiting() {
      return this.chats.filter((c) => this.activity[c.id] === 'input').length;
    },
  },

  watch: {
    view: {
      immediate: true,
      handler(v) {
        if (v === 'chat') {
          this.chatsShown = true;
          if (!this.current && this.chats.length) {
            this.go('chat', this.chats[0].id, true);
          }
        }
      },
    },

    chats(list) {
      if (this.view === 'chat' && !this.current && list.length) {
        this.go('chat', list[0].id, true);
      }
    },
  },

  methods: {
    /** To a view (and a chat), keeping the route the single place both live. */
    go(view, id = '', replace = false) {
      const to = {
        name:   CONVERSATION_ROUTE,
        params: {
          product: DEV_PRODUCT, cluster: BLANK_CLUSTER, ...(view === 'chat' ? { view: 'chat' } : {})
        },
        hash: id ? `#${ id }` : '',
      };

      (replace ? this.$router.replace(to) : this.$router.push(to)).catch(() => {});
    },

    async loadChats() {
      this.loadingChats = true;
      try {
        const list = await listConversations(CONVERSATION_WORKSPACE);

        this.chats = list.map((c) => ({ id: c.id, title: c.title, cli: c.cli || '' }));
      } catch (e) {
        this.error = `The chats could not be listed: ${ e?.message || e }`;
      } finally {
        this.loadingChats = false;
      }
    },

    async loadLinks() {
      try {
        this.links = await readLinks();
      } catch (e) {
        this.error = e?.message || String(e);
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

    /**
     * A new chat, optionally about a subject: named for it, opened with its link as the first
     * message (queued, and read by claude when the pane starts - which is the moment the chats
     * view shows it), and recorded in the links so the dashboard finds it again.
     */
    async createChat(subject = null) {
      if (this.creating) {
        return;
      }
      this.creating = true;
      this.starting = subject ? subjectKey(subject.repo, subject.number) : '';
      this.error = '';
      try {
        const title = subject ? chatTitleFor(subject) : nextChatTitle(this.chats.map((c) => c.title));
        const made = await startConversation(CONVERSATION_WORKSPACE, title, subject ? openingMessage(subject) : '');

        this.chats = [...this.chats, { id: made.id, title: made.title || title, cli: '' }];
        if (subject) {
          this.links = await updateLinks((links) => {
            links[made.id] = { ...(links[made.id] || {}), subject };
          }).catch((e) => {
            this.error = `The chat started, but its link to ${ subject.url } was not saved: ${ e?.message || e }`;

            return { ...this.links, [made.id]: { subject } };
          });
        }
        this.go('chat', made.id);
      } catch (e) {
        this.error = `A new chat could not be started: ${ e?.message || e }`;
      } finally {
        this.creating = false;
        this.starting = '';
      }
    },

    openChat(id) {
      this.go('chat', id);
    },

    async renameChat({ id, title }) {
      const chat = this.chats.find((c) => c.id === id);

      if (!chat || title === chat.title) {
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

    async closeChat(id) {
      this.error = '';
      try {
        await endConversation(CONVERSATION_WORKSPACE, id);
        const at = this.chats.findIndex((c) => c.id === id);

        this.chats = this.chats.filter((c) => c.id !== id);
        if (this.links[id]) {
          this.links = await updateLinks((links) => {
            delete links[id];
          }).catch(() => this.links);
        }
        if (this.current === id) {
          const next = this.chats[Math.min(at, this.chats.length - 1)];

          this.go('chat', next ? next.id : '', true);
        }
      } catch (e) {
        this.error = `The chat could not be closed: ${ e?.message || e }`;
      }
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
        class="conv__views"
        aria-label="Views"
      >
        <button
          type="button"
          class="conv__view"
          :class="{ 'conv__view--on': view === 'dashboard' }"
          :aria-current="view === 'dashboard' ? 'page' : null"
          data-testid="conversation-view-dashboard"
          @click="go('dashboard')"
        >
          Dashboard
        </button>
        <button
          type="button"
          class="conv__view"
          :class="{ 'conv__view--on': view === 'chat' }"
          :aria-current="view === 'chat' ? 'page' : null"
          data-testid="conversation-view-chat"
          @click="go('chat', current)"
        >
          Chats
          <span class="conv__count">{{ chats.length }}</span>
          <span
            v-if="waiting"
            class="conv__count conv__count--warn"
            :title="`${ waiting } waiting for you`"
          >{{ waiting }}</span>
        </button>
      </nav>
      <div class="conv__spacer" />
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
      </nav>
      <button
        type="button"
        class="conv__back"
        data-testid="conversation-back-to-rancher"
        @click="toRancher"
      >
        <i class="icon icon-chevron-left" /> Back to Rancher
      </button>
    </header>

    <p
      v-if="error"
      class="conv__error"
      role="alert"
    >
      {{ error }}
      <button
        type="button"
        class="conv__error-close"
        aria-label="Dismiss"
        @click="error = ''"
      >
        <i class="icon icon-close" />
      </button>
    </p>

    <ConversationDashboard
      v-if="view === 'dashboard'"
      :chats="chats"
      :activity="activity"
      :links="links"
      :name="firstName"
      :starting="starting"
      @open-chat="openChat"
      @start-chat="createChat"
      @new-chat="createChat()"
    />
    <ConversationChats
      v-if="chatsShown"
      v-show="view === 'chat'"
      :chats="chats"
      :activity="activity"
      :links="links"
      :current="current"
      :loading="loadingChats"
      :creating="creating"
      @select="(id) => go('chat', id, true)"
      @create="createChat()"
      @rename="renameChat"
      @close="closeChat"
    />
  </div>
</template>

<style lang="scss" scoped>
  // The mockup's greens. `ink` is the dark pine its primary buttons use; in Rancher's dark theme
  // that would vanish, so there it is the brighter green with dark text on it.
  .conv {
    --conv-accent:      #30ba78;
    --conv-accent-text: #1a7a4c;
    --conv-ink:         #0c322c;
    --conv-on-ink:      #ffffff;
    --conv-warn:        #c2410c;

    display:        flex;
    flex-direction: column;
    height:         100vh;
    min-height:     0;
    background:     var(--body-bg);
    color:          var(--body-text);

    &__top {
      display:       flex;
      flex-wrap:     wrap;
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

    &__views,
    &__modes {
      display: flex;
      gap:     4px;
    }

    &__view,
    &__mode {
      display:         inline-flex;
      align-items:     center;
      gap:             6px;
      padding:         5px 12px;
      border:          0;
      border-radius:   16px;
      background:      none;
      color:           var(--body-text);
      cursor:          pointer;
      font-size:       13px;
      text-decoration: none;

      &:hover {
        background: rgba(127, 127, 127, 0.12);
      }
    }

    &__view--on,
    &__view--on:hover {
      background:  var(--conv-ink);
      color:       var(--conv-on-ink);
      font-weight: 600;
    }

    &__mode {
      color:     var(--muted, #999);
      font-size: 12px;
    }

    &__count {
      min-width:     18px;
      padding:       0 5px;
      border-radius: 9px;
      background:    rgba(127, 127, 127, 0.2);
      font-size:     11px;
      text-align:    center;

      &--warn {
        background: var(--warning, #f5a623);
        color:      #1d1d1d;
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

    &__error {
      display:       flex;
      align-items:   center;
      gap:           8px;
      margin:        8px 16px 0;
      padding:       8px 12px;
      border-radius: 6px;
      background:    rgba(214, 69, 69, 0.12);
      color:         var(--error, #d64545);
      font-size:     13px;
    }

    &__error-close {
      margin-left: auto;
      border:      0;
      background:  none;
      color:       inherit;
      cursor:      pointer;
    }
  }

  :global(.theme-dark) .conv {
    --conv-ink:         #30ba78;
    --conv-on-ink:      #0c1a16;
    --conv-accent-text: #5fd39b;
    --conv-warn:        #fb923c;
  }
</style>
