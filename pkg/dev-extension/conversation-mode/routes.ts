// Conversation mode's route, beside the Dev product's own (config/constants.ts) and named the
// same way, so the route and the menu entry that leads to it agree on one constant.
import { DEV_PRODUCT } from '../config/constants';

export const CONVERSATION_PAGE = 'conversation';
export const CONVERSATION_ROUTE = `${ DEV_PRODUCT }-c-cluster-${ CONVERSATION_PAGE }`;
