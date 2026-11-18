// Conversation mode's route, beside the Dev product's own (config/constants.ts) and named the
// same way, so the route and the menu entry that leads to it agree on one constant.
//
// One path for both views, and the view is a query (`?view=chat`) with the chat as the hash -
// never a path segment. The shell's `blank` template keys its router-view by `$route.path`, so a
// path that changed between the dashboard and the chats remounted the whole page (DevShell
// included) on every switch: every chat's socket closed, and the list was read again before a
// chat made a moment earlier was in it. The workspace page keeps its tab in the hash for the
// same reason (pages/WorkspaceDetail.vue).
import { DEV_PRODUCT } from '../config/constants';

export const CONVERSATION_PAGE = 'conversation';
export const CONVERSATION_PATH = CONVERSATION_PAGE;
export const CONVERSATION_ROUTE = `${ DEV_PRODUCT }-c-cluster-${ CONVERSATION_PAGE }`;
