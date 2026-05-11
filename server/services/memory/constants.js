const MEMORY_LIMITS = {
  layer0: {
    maxMessagesPerConversation: 120,
    maxTotalCharsPerConversation: 300000,
  },
  layer1: {
    ttlMinutes: 120,
    maxItemsPerAgentRun: 30,
  },
  layer2: {
    maxActiveMemoriesPerTask: 300,
    maxActiveMemoriesPerCategory: 60,
    maxCharsPerMemory: 2000,
    defaultQueryLimit: 10,
  },
  layer3: {
    maxActiveMemoriesPerUser: 200,
    maxCharsPerMemory: 1200,
    defaultQueryLimit: 5,
  },
  skills: {
    maxGlobalSkills: 300,
    maxPrivateSkillsPerUser: 50,
    defaultQueryLimit: 3,
  },
};

const MEMORY_CATEGORIES = ["market", "finance", "tech", "risk", "deal_terms", "company_fact", "user_requirement", "open_question"];

module.exports = {
  MEMORY_LIMITS,
  MEMORY_CATEGORIES,
};
