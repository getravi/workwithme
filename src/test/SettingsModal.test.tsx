import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from '../SettingsModal';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../config', () => ({ API_BASE: 'http://localhost:4242' }));

// Stub EventSource globally
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = MockEventSource.OPEN;
  onerror: (() => void) | null = null;
  private listeners: Record<string, EventListener[]> = {};

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: EventListener) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: EventListener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(f => f !== fn);
  }
  getListeners(type: string) { return this.listeners[type] ?? []; }
  emit(type: string, data: unknown) {
    const event = Object.assign(new Event(type), { data: JSON.stringify(data) });
    for (const fn of this.getListeners(type)) fn(event);
  }
  close() { this.readyState = MockEventSource.CLOSED; }

  static instances: MockEventSource[] = [];
  static reset() { MockEventSource.instances = []; }
  static latest() { const a = MockEventSource.instances; return a[a.length - 1]; }
}

vi.stubGlobal('EventSource', MockEventSource);

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ──────────────────────────────────────────────────────────────────

function authResponse(configured: string[] = [], available = ['anthropic']) {
  return { ok: true, json: async () => ({ configured, availableProviders: available }) };
}
function oauthProvidersResponse(providers = [{ id: 'google', name: 'Google' }]) {
  return { ok: true, json: async () => ({ providers }) };
}

function renderModal(isOpen = true, isConnected = true) {
  const onClose = vi.fn();
  const { unmount } = render(
    <SettingsModal isOpen={isOpen} onClose={onClose} isConnected={isConnected} />
  );
  return { onClose, unmount };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SettingsModal', () => {
  beforeEach(() => {
    MockEventSource.reset();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('renders nothing when isOpen=false', () => {
    renderModal(false);
    expect(screen.queryByText('Engine Settings')).toBeNull();
  });

  it('renders the modal when isOpen=true', async () => {
    mockFetch.mockResolvedValue(authResponse());
    mockFetch.mockResolvedValueOnce(authResponse());
    mockFetch.mockResolvedValueOnce(oauthProvidersResponse());
    renderModal();
    expect(screen.getByText('Engine Settings')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('sk-...')).toBeInTheDocument();
  });

  it('shows loading banner when not connected', () => {
    renderModal(true, false);
    // Two "starting up" strings exist; check the connection banner specifically
    expect(screen.getByText(/starting up.*settings will load/i)).toBeInTheDocument();
  });

  it('Save Key button is disabled when api key input is empty', async () => {
    mockFetch.mockResolvedValueOnce(authResponse()).mockResolvedValueOnce(oauthProvidersResponse());
    renderModal();
    expect(screen.getByRole('button', { name: /save key/i })).toBeDisabled();
  });

  it('calls POST /api/auth/key and shows success on valid key', async () => {
    mockFetch
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(oauthProvidersResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce(authResponse(['anthropic']))
      .mockResolvedValueOnce(oauthProvidersResponse());

    renderModal();
    await userEvent.type(screen.getByPlaceholderText('sk-...'), 'sk-test-key-1234');
    await userEvent.click(screen.getByRole('button', { name: /save key/i }));

    await waitFor(() => expect(screen.getByText(/key securely saved/i)).toBeInTheDocument());
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4242/api/auth/key',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('shows error message when save key fails', async () => {
    // Route by URL to avoid fragile call-order counting (fetchAuthStatus runs twice
    // due to selectedProvider dep change re-triggering the useEffect)
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes('/api/auth/key')) {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'Bad key' }) });
      }
      if (String(url).includes('/api/auth/oauth-providers')) {
        return Promise.resolve(oauthProvidersResponse());
      }
      return Promise.resolve(authResponse());
    });

    renderModal();
    await waitFor(() => expect(screen.getByRole('option', { name: /anthropic/i })).toBeInTheDocument());
    await userEvent.type(screen.getByPlaceholderText('sk-...'), 'bad-key-123');
    await userEvent.click(screen.getByRole('button', { name: /save key/i }));

    await waitFor(() => expect(screen.getByText('Bad key')).toBeInTheDocument());
  });

  it('OAuth buttons are rendered for each provider', async () => {
    mockFetch
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(oauthProvidersResponse([
        { id: 'google', name: 'Google' },
        { id: 'github', name: 'GitHub' },
      ]));

    renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Google' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeInTheDocument();
  });

  it('clicking OAuth button opens an EventSource with encoded provider param', async () => {
    mockFetch
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(oauthProvidersResponse());

    renderModal();
    await waitFor(() => screen.getByRole('button', { name: 'Google' }));
    await userEvent.click(screen.getByRole('button', { name: 'Google' }));

    const es = MockEventSource.latest()!;
    expect(es).toBeDefined();
    expect(es.url).toContain('provider=google');
    // provider param must be encoded via searchParams (no raw interpolation)
    expect(es.url).toMatch(/[?&]provider=google$/);
  });

  it('OAuth button is disabled while a flow is in progress', async () => {
    mockFetch
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(oauthProvidersResponse());

    renderModal();
    await waitFor(() => screen.getByRole('button', { name: 'Google' }));
    await userEvent.click(screen.getByRole('button', { name: 'Google' }));

    expect(screen.getByRole('button', { name: 'Google' })).toBeDisabled();
  });

  it('double-clicking OAuth button does not open two EventSources', async () => {
    mockFetch
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(oauthProvidersResponse());

    renderModal();
    await waitFor(() => screen.getByRole('button', { name: 'Google' }));
    const btn = screen.getByRole('button', { name: 'Google' });
    // First click starts flow and disables button
    await userEvent.click(btn);
    // Button is now disabled — userEvent won't fire on disabled, but call handler directly
    await userEvent.click(btn);

    expect(MockEventSource.instances).toHaveLength(1);
  });

  it('EventSource listeners are removed on cleanup (modal close)', async () => {
    mockFetch
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(oauthProvidersResponse());

    const { unmount } = renderModal();
    await waitFor(() => screen.getByRole('button', { name: 'Google' }));
    await userEvent.click(screen.getByRole('button', { name: 'Google' }));

    const es = MockEventSource.latest()!;
    expect(es.getListeners('auth_instructions')).toHaveLength(1);

    unmount(); // triggers cleanupOAuthFlow via useEffect return
    expect(es.getListeners('auth_instructions')).toHaveLength(0);
    expect(es.getListeners('progress')).toHaveLength(0);
    expect(es.getListeners('success')).toHaveLength(0);
    expect(es.getListeners('error')).toHaveLength(0);
  });

  it('shows auth instructions URL when server emits auth_instructions', async () => {
    mockFetch
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(oauthProvidersResponse());

    renderModal();
    await waitFor(() => screen.getByRole('button', { name: 'Google' }));
    await userEvent.click(screen.getByRole('button', { name: 'Google' }));

    const es = MockEventSource.latest()!;
    es.emit('auth_instructions', { url: 'https://accounts.google.com/oauth', instructions: 'Open this URL' });

    await waitFor(() => expect(screen.getByText('https://accounts.google.com/oauth')).toBeInTheDocument());
    expect(screen.getByText('Open this URL')).toBeInTheDocument();
  });

  it('shows success state when server emits success event', async () => {
    mockFetch
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(oauthProvidersResponse())
      .mockResolvedValueOnce(authResponse(['google']))
      .mockResolvedValueOnce(oauthProvidersResponse());

    renderModal();
    await waitFor(() => screen.getByRole('button', { name: 'Google' }));
    await userEvent.click(screen.getByRole('button', { name: 'Google' }));

    const es = MockEventSource.latest()!;
    es.emit('success', { success: true });

    await waitFor(() => expect(screen.getByText(/key securely saved/i)).toBeInTheDocument());
    expect(es.readyState).toBe(MockEventSource.CLOSED);
  });

  it('shows error state when server emits application error', async () => {
    mockFetch
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(oauthProvidersResponse());

    renderModal();
    await waitFor(() => screen.getByRole('button', { name: 'Google' }));
    await userEvent.click(screen.getByRole('button', { name: 'Google' }));

    const es = MockEventSource.latest()!;
    es.emit('error', { error: 'Token exchange failed' });

    await waitFor(() => expect(screen.getByText('Token exchange failed')).toBeInTheDocument());
  });
});
