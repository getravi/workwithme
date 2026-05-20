import type { ReactNode } from "react";
import { WebSocketProvider } from "./context/WebSocketContext";
import { SessionProvider } from "./context/SessionContext";
import { ChatProvider } from "./context/ChatContext";
import { UIProvider } from "./context/UIContext";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <WebSocketProvider>
      <SessionProvider>
        <ChatProvider>
          <UIProvider>{children}</UIProvider>
        </ChatProvider>
      </SessionProvider>
    </WebSocketProvider>
  );
}
