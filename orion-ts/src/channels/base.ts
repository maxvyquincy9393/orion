export interface BaseChannel {
  readonly name: string
  isConnected(): boolean
  send(userId: string, message: string): Promise<boolean>
  sendWithConfirm(userId: string, message: string, action: string): Promise<boolean>
  getLatestReply(userId: string, sinceSeconds?: number): Promise<string | null>
  start(): Promise<void>
  stop(): Promise<void>
}
