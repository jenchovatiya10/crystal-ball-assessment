import type { ConversationService } from "../services/conversation.service.js";
import { createAssistantStreamController } from "./stream.controller.js";

export function createTeachController(conversationService: ConversationService) {
  return createAssistantStreamController(conversationService, "teach_me");
}
