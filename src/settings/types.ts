export type AuthStatus = "idle" | "saving" | "success" | "error" | "oauth_loading";

export interface OAuthProvider {
  id: string;
  name: string;
  category: string;
  available: boolean;
}

export interface PendingOAuthFlow {
  pendingId: string;
  provider: string;
  kind: "oauth" | "device";
}
