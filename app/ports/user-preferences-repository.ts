export type UserPreferencesRecord = Readonly<{
  userEmail: string;
  displayTimezone: string;
  replySignature: string;
  notificationPreferencesJson: string;
  pageLayoutsJson: string;
  updatedAt: number;
}>;

export interface UserPreferencesRepository {
  findByEmail(email: string): Promise<UserPreferencesRecord | null>;
  upsert(record: UserPreferencesRecord): Promise<void>;
}
