import type { ConversationService } from "../services/conversation.service.js";
import { createAssistantStreamController } from "./stream.controller.js";

export function createChatController(conversationService: ConversationService) {
  return createAssistantStreamController(conversationService, "talk_to_me");
}
