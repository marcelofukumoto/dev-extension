<script>
// Conversation mode's chats: a rail of what they are about, and the chats of the one chosen.
//
// The rail is the Dev product's sidebar shape (rail.mjs): DEVELOPER for your pull requests and
// issues, REVIEWER for the pull requests you review, OTHER for chats about neither. An issue or a
// pull request is one item, its chats are its tabs, and its header is what the Dev product shows
// for one: the title, where it stands, and the stage strip (StageSteps, with the Dev product's
// own steps). A chat in OTHER is an item of its own.
//
// The list, what each agent is doing, which chat is about what, GitHub and which chat is current
// belong to the page around this (ConversationMode.vue); this draws them and says what was asked.
// A chat's pane is mounted the first time it is current and kept, so going back to it - or to the
// dashboard and back - is instant and keeps its socket.
import StudioTerminal from '../components/StudioTerminal.vue';
import StageSteps from '../components/StageSteps.vue';
import AppIcon from '../components/focus/AppIcon.vue';
import ClaudeUsage from './ClaudeUsage.vue';
import ReviewRounds from './ReviewRounds.vue';
import { FIX_STEPS, REVIEW_STEPS } from '../workspace-rail';
import { chatCommand } from './config.mjs';
import { railSections, filterRail } from './rail.mjs';
import { ago, chatAction } from './projects.mjs';

/** Chips in the links bar before "+N more". */
const LINKS_SHOWN = 8;

/** What a chip says it is, before its label. */
const LINK_KIND = {
  preview: 'Preview', page: 'Page', pr: 'PR', issue: 'Issue', ci: 'CI', env: 'Rancher', jira: 'Jira', doc: 'Docs', other: ''
};

const STATE_LABEL = {
  working: 'Working', input: 'Waiting for you', idle: 'Idle', finished: 'Done', none: 'Not running'
};

const SECTION_ICON = {
  developer: 'pencil', reviewer: 'check', other: 'comment', quiet: 'snooze', done: 'clock'
};

export default {
  name: 'ConversationChats',

  components: {
    StudioTerminal, StageSteps, AppIcon, ClaudeUsage, ReviewRounds
  },

  emits: ['select', 'create', 'rename', 'close', 'archive', 'send'],

  props: {
    chats:     { type: Array, default: () => [] },
    activity:  { type: Object, default: () => ({}) },
    links:     { type: Object, default: () => ({}) },
    /** chat id -> its links as chips (linkify.mjs, chatLinks). */
    chatLinks: { type: Object, default: () => ({}) },
    /** GitHub as myWork() answers it: where each item stands. */
    work:      { type: Object, default: () => ({}) },
    current:   { type: String, default: '' },
    /** The keys marked "Nothing to do" that still hold (nothing-to-do.mjs): their items go aside. */
    quietKeys: { type: Set, default: () => new Set() },
    /** chat id -> the last message you sent it ({ text, at }): shown above the chat, so it says where it stands. */
    lastSaid:  { type: Object, default: () => ({}) },
    /** chat id -> when it last moved, in ms (rail.mjs, lastUpdated): each section, newest first. */
    lastAt:    { type: Object, default: () => ({}) },
    loading:   { type: Boolean, default: false },
    creating:  { type: Boolean, default: false },
  },

  data() {
    return {
      opened:     {},
      renaming:   '',
      renameText: '',
      closing:    '',
      linksAll:   false,
      query:      '',
      /** The chat last open in each item, so going back to an item goes back to it. */
      lastInItem: {},
      /** Whether the Done group is open; it starts shut, and a search opens it. */
      doneOpen:   false,
      /** Whether the last message you sent is shown whole rather than in two lines. */
      saidOpen:   false,
      /** The header's Work on it / Review it, asked to confirm: its text shown, Send or Cancel. */
      confirming: false,
    };
  },

  computed: {
    LINKS_SHOWN: () => LINKS_SHOWN,

    sections() {
      return railSections(this.chats, this.links, this.work, this.activity, this.quietKeys, this.lastAt);
    },

    shownSections() {
      return filterRail(this.sections, this.query);
    },

    items() {
      return this.sections.flatMap((s) => s.items);
    },

    currentItem() {
      return this.items.find((i) => i.chatIds.includes(this.current)) || null;
    },

    itemChats() {
      const ids = this.currentItem?.chatIds || [];

      return this.chats.filter((c) => ids.includes(c.id));
    },

    steps() {
      const item = this.currentItem;

      if (!item?.subject || item.status.stage < 0) {
        return [];
      }

      return item.role === 'reviewer' ? REVIEW_STEPS : FIX_STEPS;
    },

    /** How many times you reviewed the open chat's pull request, when it is one you review (rail.mjs). */
    currentRounds() {
      return this.currentItem?.rounds;
    },

    /**
     * The header's button for the open chat ({ id, label, text }), or null: none once archived.
     * Not hidden when GitHub no longer lists it (`finished`): an issue picked from Find work is not
     * assigned to you yet, and that is when Work on it is wanted.
     */
    action() {
      const item = this.currentItem;

      return item && !item.archived ? chatAction(item.subject, item.role, item.rounds) : null;
    },

    currentChatTitle() {
      return this.chats.find((c) => c.id === this.current)?.title || 'this chat';
    },

    /** The last message you sent the open chat ({ text, at }), or null. */
    currentSaid() {
      const said = this.lastSaid[this.current];

      return said?.text ? said : null;
    },

    saidWhen() {
      return this.currentSaid?.at ? ago(this.currentSaid.at) : '';
    },

    /** Longer than its two lines: it gets More. */
    saidLong() {
      const text = this.currentSaid?.text || '';

      return text.length > 180 || text.split('\n').length > 2;
    },

    currentLinks() {
      return this.chatLinks[this.current] || [];
    },

    /**
     * The chips in view: the ones that name something (pull requests, previews, pages, CI, Jira,
     * docs) - a site the agent happened to cite while searching waits behind "+N more".
     */
    shownLinks() {
      return this.linksAll ? this.currentLinks : this.currentLinks.filter((l) => l.kind !== 'other').slice(0, LINKS_SHOWN);
    },
  },

  watch: {
    current: {
      immediate: true,
      handler(id) {
        if (id && !this.opened[id]) {
          this.opened = { ...this.opened, [id]: true };
        }
        if (id && this.currentItem) {
          this.lastInItem = { ...this.lastInItem, [this.currentItem.key]: id };
        }
        this.closing = '';
        this.linksAll = false;
        this.saidOpen = false;
        this.confirming = false;
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
    /** Send the header button's prompt to the open chat (ConversationMode.vue types it in). */
    sendAction() {
      if (this.action && this.current) {
        this.$emit('send', { id: this.current, text: this.action.text });
      }
      this.confirming = false;
    },

    /** The item's hover: its title, and when its chat last moved (the rail's order). */
    itemTitle(item) {
      return item.last ? `${ item.title } - last message ${ ago(new Date(item.last).toISOString()) }` : item.title;
    },

    command(chat) {
      return chatCommand(chat.id, chat.cli);
    },

    icon: (section) => SECTION_ICON[section] || 'comment',

    openItem(item) {
      const last = this.lastInItem[item.key];

      this.$emit('select', item.chatIds.includes(last) ? last : item.chatIds[0]);
    },

    /** A new chat in the current item: about the same subject, or a chat of its own in OTHER. */
    newChatHere() {
      this.$emit('create', this.currentItem?.subject ? { subject: this.currentItem.subject, quiet: true } : null);
    },

    /** A tab's label: the chat's title without the item's own reference in front of it. */
    tabLabel(chat) {
      const ref = this.currentItem?.ref;
      const rest = ref && chat.title.startsWith(ref) ? chat.title.slice(ref.length).replace(/^[\s·:-]+/, '') : chat.title;

      return rest || 'Chat';
    },

    stateOf(id) {
      return this.activity[id] || 'none';
    },

    stateLabel(id) {
      return STATE_LABEL[this.stateOf(id)] || '';
    },

    /** "PR", "Preview", … - the subject chip says what the subject is (a PR or an issue). */
    linkKind(link) {
      return link.kind === 'subject' ? (link.sub === 'issue' ? 'Issue' : 'PR') : LINK_KIND[link.kind] || '';
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
    <aside
      class="chats__rail"
      aria-label="Chats by what they are about"
    >
      <div class="chats__find">
        <input
          v-model="query"
          type="search"
          class="chats__find-input"
          placeholder="Find a chat"
          aria-label="Find a chat"
        >
        <button
          type="button"
          class="chats__find-new"
          :disabled="creating"
          title="New chat"
          aria-label="New chat"
          data-testid="conversation-new"
          @click="$emit('create', null)"
        >
          <AppIcon
            :name="creating ? 'spinner' : 'plus'"
            :size="14"
          />
        </button>
      </div>
      <p
        v-if="loading"
        class="chats__rail-empty"
      >
        Loading your chats…
      </p>
      <template
        v-for="sec in shownSections"
        :key="sec.id"
      >
        <section
          v-if="sec.items.length"
          class="chats__sec"
          :data-testid="`rail-${ sec.id }`"
        >
          <h3 class="chats__sec-head">
            <AppIcon
              :name="icon(sec.id)"
              :size="12"
            />
            <button
              v-if="sec.id === 'done'"
              type="button"
              class="chats__sec-toggle"
              :aria-expanded="doneOpen || query ? 'true' : 'false'"
              data-testid="rail-done-toggle"
              @click="doneOpen = !doneOpen"
            >
              {{ sec.label }} ({{ sec.items.length }}) <AppIcon
                :name="doneOpen || query ? 'chevron-up' : 'chevron-down'"
                :size="11"
              />
            </button>
            <template v-else>
              {{ sec.label }}
            </template>
          </h3>
          <button
            v-for="item in (sec.id !== 'done' || doneOpen || query ? sec.items : [])"
            :key="item.key"
            type="button"
            class="chats__item"
            :class="[{ 'chats__item--on': currentItem && item.key === currentItem.key }, `chats__item--${ item.activity }`]"
            :data-chat-state="item.activity"
            :title="itemTitle(item)"
            :data-testid="`rail-item-${ item.key }`"
            @click="openItem(item)"
          >
            <span
              class="chats__dot"
              :class="`chats__dot--${ item.activity }`"
              :aria-label="stateLabel(item.chatIds.find((id) => stateOf(id) === item.activity) || '')"
            />
            <span class="chats__item-text">
              <span class="chats__item-title">{{ item.title }}</span>
              <span class="chats__item-meta">
                <template v-if="item.ref">{{ item.ref }}</template>
                <span
                  v-if="item.status.text"
                  :class="`chats__status chats__status--${ item.status.tone || 'plain' }`"
                >{{ item.ref ? ' · ' : '' }}{{ item.status.text }}</span>
                <template v-if="item.chatIds.length > 1"> · {{ item.chatIds.length }} chats</template>
              </span>
            </span>
          </button>
        </section>
      </template>
      <p
        v-if="!loading && !chats.length"
        class="chats__rail-empty"
      >
        No chats yet. Start one with +, or from a pull request on the dashboard.
      </p>
      <ClaudeUsage class="chats__usage" />
    </aside>

    <div class="chats__main">
      <header
        v-if="currentItem"
        class="chats__head"
      >
        <div class="chats__head-text">
          <a
            v-if="currentItem.url"
            class="chats__head-title"
            :href="currentItem.url"
            target="_blank"
            rel="noopener noreferrer"
          >{{ currentItem.title }}</a>
          <span
            v-else
            class="chats__head-title"
          >{{ currentItem.title }}</span>
          <span class="chats__head-meta">
            {{ currentItem.ref || 'Chat' }}<template v-if="currentItem.status.text"> · <span :class="`chats__status chats__status--${ currentItem.status.tone || 'plain' }`">{{ currentItem.status.text }}</span></template>
          </span>
        </div>
        <StageSteps
          v-if="steps.length && !currentItem.archived"
          class="chats__stages"
          :steps="steps"
          :current-index="currentItem.status.stage"
        />
        <div class="chats__head-actions">
          <button
            v-if="action"
            type="button"
              class="chats__action"
            :class="{ 'chats__action--on': confirming }"
            :title="`Send the ${ action.label.toLowerCase() } prompt to this chat - you see it first`"
            :data-action="action.id"
            data-testid="chat-action"
            @click="confirming = !confirming"
          >
            {{ action.label }}
          </button>
          <button
            type="button"
            class="chats__archive"
            :title="currentItem.archived ? 'Bring it back to the dashboard and the rail' : 'Take it off the dashboard and file it under Done; the chats stay'"
            data-testid="chat-archive"
            @click="$emit('archive', { ids: currentItem.chatIds, archived: !currentItem.archived })"
          >
            {{ currentItem.archived ? 'Unarchive' : 'Archive' }}
          </button>
        </div>
      </header>

      <div
        v-if="currentItem"
        class="chats__tabs"
        role="tablist"
        aria-label="Chats"
      >
        <div
          v-for="chat in itemChats"
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
            :title="`${ chat.title } - ${ stateLabel(chat.id) } - double-click to rename`"
            :data-testid="`conversation-tab-${ chat.id }`"
            @click="$emit('select', chat.id)"
            @dblclick="startRename(chat)"
          >
            <span
              class="chats__dot"
              :class="`chats__dot--${ stateOf(chat.id) }`"
              :aria-label="stateLabel(chat.id)"
            />
            <span class="chats__title">{{ tabLabel(chat) }}</span>
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
          data-testid="conversation-new-here"
          @click="newChatHere"
        >
          <AppIcon
            :name="creating ? 'spinner' : 'plus'"
            :size="14"
          />
          {{ currentItem.subject ? `New chat on ${ currentItem.ref }` : 'New chat' }}
        </button>
      </div>

      <div
        v-if="confirming && action"
        class="chats__confirm"
        data-testid="chat-action-confirm"
      >
        <p class="chats__confirm-help">
          {{ action.label }} sends this to <strong>{{ currentChatTitle }}</strong>:
        </p>
        <pre class="chats__confirm-text">{{ action.text }}</pre>
        <div class="chats__confirm-buttons">
          <button
            type="button"
            class="chats__action"
            data-testid="chat-action-send"
            @click="sendAction"
          >
            Send
          </button>
          <button
            type="button"
            class="chats__archive"
            data-testid="chat-action-cancel"
            @click="confirming = false"
          >
            Cancel
          </button>
        </div>
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
          v-if="linksAll || currentLinks.length > shownLinks.length"
          type="button"
          class="chats__link-more"
          @click="linksAll = !linksAll"
        >
          {{ linksAll ? 'Fewer' : `+${ currentLinks.length - shownLinks.length } more` }}
        </button>
      </nav>

      <div
        v-if="currentRounds"
        class="chats__rounds"
        data-testid="chat-rounds"
      >
        <ReviewRounds :rounds="currentRounds" />
      </div>

      <div
        v-if="currentSaid"
        class="chats__said"
        :class="{ 'chats__said--open': saidOpen }"
        data-testid="chat-last-said"
      >
        <span class="chats__said-who">You{{ currentSaid.at ? ` · ${ saidWhen }` : '' }}</span>
        <p class="chats__said-text">{{ currentSaid.text }}</p>
        <button
          v-if="saidLong"
          type="button"
          class="chats__said-more"
          :aria-expanded="saidOpen ? 'true' : 'false'"
          @click="saidOpen = !saidOpen"
        >
          {{ saidOpen ? 'Less' : 'More' }}
        </button>
      </div>

      <main class="chats__body">
        <div
          v-if="!loading && !chats.length"
          class="chats__empty"
        >
          <p>No chats yet. Each one works in the interrupt-duty repo, with its memory and tools.</p>
          <button
            type="button"
            class="chats__new chats__new--big"
            :disabled="creating"
            @click="$emit('create', null)"
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
    flex-direction: row;
    min-height:     0;

    // The rail: the Dev product's sidebar, in the mockup's colours.
    &__rail {
      flex:           0 0 280px;
      display:        flex;
      flex-direction: column;
      gap:            4px;
      min-height:     0;
      padding:        10px 8px;
      overflow-y:     auto;
      border-right:   1px solid var(--conv-line);
      background:     var(--conv-surface);
    }

    // The plan's usage, held at the foot of the rail however long the list is.
    &__usage {
      position:    sticky;
      bottom:      -10px;
      margin:      auto -8px -10px;
      padding:     10px 12px 12px;
      border-top:  1px solid var(--conv-line);
      background:  var(--conv-surface);
    }

    &__find {
      display: flex;
      gap:     6px;
      padding: 0 4px 6px;
    }

    &__find-input {
      flex:          1 1 auto;
      min-width:     0;
      padding:       6px 10px;
      border:        1px solid var(--conv-line);
      border-radius: 8px;
      background:    var(--conv-page);
      color:         var(--conv-text);
      font-size:     13px;
    }

    &__find-new {
      display:         inline-flex;
      align-items:     center;
      justify-content: center;
      width:           32px;
      border:          1px solid var(--conv-line);
      border-radius:   8px;
      background:      var(--conv-surface);
      color:           var(--conv-ink);
      cursor:          pointer;
    }

    &__rail-empty {
      margin:    8px;
      color:     var(--conv-muted);
      font-size: 12px;
    }

    &__sec {
      margin-top: 6px;
    }

    &__sec-head {
      display:        flex;
      align-items:    center;
      gap:            6px;
      margin:         6px 8px 4px;
      color:          var(--conv-meta);
      font-size:      11px;
      font-weight:    700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    &__sec-toggle {
      display:        inline-flex;
      align-items:    center;
      gap:            4px;
      padding:        0;
      border:         0;
      background:     none;
      color:          inherit;
      cursor:         pointer;
      font:           inherit;
      letter-spacing: inherit;
      text-transform: inherit;
    }

    &__item {
      display:       flex;
      align-items:   flex-start;
      // Rancher's button rule keeps text on one line; an item's title wraps to two.
      white-space:   normal;
      gap:           8px;
      width:         100%;
      padding:       8px 10px;
      border:        0;
      border-radius: 8px;
      background:    none;
      color:         var(--conv-text);
      cursor:        pointer;
      text-align:    left;

      &:hover { background: var(--conv-page); }

      &--on {
        background: var(--conv-mint);
        outline:    1px solid var(--conv-mint-line);

        &:hover { background: var(--conv-mint); }
      }

      // Its chat is working: the dashboard's working blue, the edge pulsing with the dot. Waiting
      // for you: orange. Over the selection's mint and the hover, which keep only their outline.
      &--working,
      &--working:hover {
        background: var(--conv-working-bg);
        animation:  chats-item-working 1.4s ease-in-out infinite;
      }

      &--input,
      &--input:hover {
        background: var(--conv-waiting-bg);
        box-shadow: inset 4px 0 0 var(--conv-orange);
      }

      @media (prefers-reduced-motion: reduce) {
        &--working { animation: none; box-shadow: inset 4px 0 0 var(--conv-working); }
      }

      .chats__dot { margin-top: 6px; }
    }

    &__item-text {
      display:        flex;
      flex-direction: column;
      min-width:      0;
    }

    &__item-title {
      display:            -webkit-box;
      overflow:           hidden;
      overflow-wrap:      anywhere;
      font-size:          13px;
      font-weight:        600;
      line-height:        1.3;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    &__item-meta {
      color:     var(--conv-meta);
      font-size: 11px;
    }

    &__status {
      &--warn { color: var(--conv-orange-text); font-weight: 600; }
      &--alert { color: var(--conv-blocked); font-weight: 600; }
      &--ok { color: var(--conv-ok); font-weight: 600; }
    }

    &__main {
      display:        flex;
      flex:           1 1 auto;
      flex-direction: column;
      min-width:      0;
      min-height:     0;
    }

    &__head {
      display:       flex;
      flex-wrap:     wrap;
      align-items:   center;
      justify-content: space-between;
      gap:           12px;
      padding:       12px 18px;
      border-bottom: 1px solid var(--conv-line);
      background:    var(--conv-surface);
    }

    // Work on it / Review it: the one dark button in the header, beside Archive.
    &__action {
      padding:       5px 12px;
      border:        1px solid var(--conv-ink);
      border-radius: 6px;
      background:    var(--conv-ink);
      color:         var(--conv-on-ink);
      cursor:        pointer;
      font-size:     12px;
      font-weight:   600;

      &--on,
      &:hover { opacity: 0.85; }
    }

    // What the button would send, before it is sent.
    &__confirm {
      flex:          0 0 auto;
      padding:       10px 16px;
      border-bottom: 1px solid var(--conv-line);
      background:    var(--conv-subtle);
      font-size:     13px;
    }

    &__confirm-help {
      margin: 0 0 6px;
      color:  var(--conv-text);
    }

    &__confirm-text {
      max-height:    30vh;
      margin:        0 0 8px;
      padding:       8px 10px;
      overflow-y:    auto;
      border:        1px solid var(--conv-line);
      border-radius: 6px;
      background:    var(--conv-surface);
      color:         var(--conv-text);
      font-family:   inherit;
      font-size:     12px;
      line-height:   1.45;
      white-space:   pre-wrap;
    }

    &__confirm-buttons {
      display: flex;
      gap:     8px;
    }

    &__archive {
      padding:       5px 12px;
      border:        1px solid var(--conv-line);
      border-radius: 6px;
      background:    var(--conv-surface);
      color:         var(--conv-text);
      cursor:        pointer;
      font-size:     12px;

      &:hover { border-color: var(--conv-ink); }
    }

    &__head-text {
      display:        flex;
      flex:           1 1 240px;
      flex-direction: column;
      min-width:      0;
    }

    // Work on it / Review it and Archive stay together, at the right.
    &__head-actions {
      display:     flex;
      flex:        0 0 auto;
      gap:         8px;
      margin-left: auto;
    }

    &__head-title {
      overflow:        hidden;
      color:           var(--conv-ink);
      font-size:       17px;
      font-weight:     600;
      text-decoration: none;
      text-overflow:   ellipsis;
      white-space:     nowrap;

      &:hover { text-decoration: underline; }
    }

    &__head-meta {
      color:     var(--conv-meta);
      font-size: 12px;
    }

    // Shrinks before anything wraps: the title, the steps and the buttons share one line.
    &__stages {
      flex:      1 1 360px;
      max-width: 560px;
    }

    // Every row above the chat keeps its height: the body is the one that grows, and without this
    // the tab strip was the one squashed when the body asked for room.
    &__head,
    &__tabs,
    &__links,
    &__rounds,
    &__said {
      flex: 0 0 auto;
    }

    // How many times you reviewed the pull request: one line under its links.
    &__rounds {
      padding:       5px 16px;
      border-bottom: 1px solid var(--conv-line);
      background:    var(--conv-surface);
    }

    // The last message you sent this chat: what it was last asked, so where it stands is a glance.
    &__said {
      display:       flex;
      align-items:   flex-start;
      gap:           10px;
      padding:       8px 16px;
      border-bottom: 1px solid var(--conv-line);
      background:    var(--conv-subtle);
      font-size:     13px;
    }

    &__said-who {
      flex:        0 0 auto;
      padding-top: 1px;
      color:       var(--conv-meta);
      font-size:   12px;
      font-weight: 600;
      white-space: nowrap;
    }

    &__said-text {
      flex:               1 1 auto;
      display:            -webkit-box;
      min-width:          0;
      margin:             0;
      overflow:           hidden;
      color:              var(--conv-text);
      line-height:        1.4;
      white-space:        pre-wrap;
      overflow-wrap:      anywhere;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    &__said--open &__said-text {
      display:    block;
      max-height: 40vh;
      overflow-y: auto;
    }

    &__said-more {
      flex:        0 0 auto;
      padding:     0;
      border:      0;
      background:  none;
      color:       var(--conv-link);
      cursor:      pointer;
      font-size:   12px;
    }

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
        background: var(--conv-working);
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

  @keyframes chats-item-working {
    0%, 100% { box-shadow: inset 4px 0 0 var(--conv-working); }
    50% { box-shadow: inset 4px 0 0 var(--conv-working-line); }
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
