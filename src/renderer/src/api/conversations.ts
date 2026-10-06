import { api } from './client'
import type {
  ConversationStats,
  ConversationSummary,
  MessagePage,
  MessageQuery
} from '@shared/types'

/** 会话与消息相关调用的薄封装，组件里只 import 这个文件 */
export const conversationApi = {
  list: (options?: { query?: string; limit?: number }) => api.invoke('conversation:list', options ?? {}),
  locate: (username: string) => api.invoke('conversation:locate', { username }),
  messages: (query: MessageQuery): Promise<MessagePage> => api.invoke('conversation:messages', query),
  sync: (username: string, after?: number) => api.invoke('conversation:sync', { username, after }),
  stats: (username: string): Promise<ConversationStats> => api.invoke('conversation:stats', { username }),
  search: (keyword: string, limit?: number) => api.invoke('conversation:search', { keyword, limit })
}

export type { ConversationSummary }
