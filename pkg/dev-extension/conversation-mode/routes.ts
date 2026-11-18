// Conversation mode's route, beside the Dev product's own (config/constants.ts) and named the
// same way, so the route and the menu entry that leads to it agree on one constant.
//
// One route for both views: no `view` is the dashboard, `chat` is the chats (with the chat as the
// hash). One route name means DevShell's `bare()` and the menu need to know about it once.
import { DEV_PRODUCT } from '../config/constants';

export const CONVERSATION_PAGE = 'conversation';
export const CONVERSATION_PATH = `${ CONVERSATION_PAGE }/:view?`;
export const CONVERSATION_ROUTE = `${ DEV_PRODUCT }-c-cluster-${ CONVERSATION_PAGE }`;
