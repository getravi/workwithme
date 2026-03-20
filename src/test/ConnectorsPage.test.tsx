import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectorsPage } from '../ConnectorsPage';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../config', () => ({ API_BASE: 'http://localhost:4242' }));

// vi.hoisted so the factory can reference mockOpenUrl before the import is resolved
const { mockOpenUrl } = vi.hoisted(() => ({ mockOpenUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: mockOpenUrl }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeConnector(overrides: Partial<{
  id: string; name: string; type: string; status: string;
  category: string; description: string; docsUrl: string; requiresToken: boolean;
}> = {}) {
  return {
    id: `remote-mcp/${overrides.name?.toLowerCase() ?? 'stripe'}`,
    name: 'Stripe',
    type: 'remote-mcp',
    status: 'available',
    category: 'Finance',
    description: 'Payments API',
    requiresToken: true,
    docsUrl: 'https://docs.stripe.com',
    ...overrides,
  };
}

function connectorsResponse(connectors: ReturnType<typeof makeConnector>[] = [makeConnector()]) {
  return { ok: true, json: async () => ({ connectors }) };
}

function renderPage() {
  const onOpenSettings = vi.fn();
  render(<ConnectorsPage onOpenSettings={onOpenSettings} />);
  return { onOpenSettings };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ConnectorsPage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockOpenUrl.mockReset();
    mockFetch.mockResolvedValue(connectorsResponse());
  });

  it('renders connector list from API response', async () => {
    mockFetch.mockResolvedValue(connectorsResponse([
      makeConnector({ name: 'Stripe', category: 'Finance' }),
      makeConnector({ id: 'remote-mcp/github', name: 'GitHub', category: 'Developer Tools' }),
    ]));

    renderPage();
    await waitFor(() => expect(screen.getByText('Stripe')).toBeInTheDocument());
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('search filter narrows results by name', async () => {
    mockFetch.mockResolvedValue(connectorsResponse([
      makeConnector({ name: 'Stripe' }),
      makeConnector({ id: 'remote-mcp/github', name: 'GitHub', category: 'Developer Tools' }),
    ]));

    renderPage();
    await waitFor(() => screen.getByText('Stripe'));

    await userEvent.type(screen.getByPlaceholderText(/search connectors/i), 'stripe');
    expect(screen.getByText('Stripe')).toBeInTheDocument();
    expect(screen.queryByText('GitHub')).toBeNull();
  });

  it('search filter matches description', async () => {
    mockFetch.mockResolvedValue(connectorsResponse([
      makeConnector({ name: 'Stripe', description: 'Payment processing' }),
      makeConnector({ id: 'remote-mcp/github', name: 'GitHub', description: 'Code hosting', category: 'Developer Tools' }),
    ]));

    renderPage();
    await waitFor(() => screen.getByText('Stripe'));

    await userEvent.type(screen.getByPlaceholderText(/search connectors/i), 'payment');
    expect(screen.getByText('Stripe')).toBeInTheDocument();
    expect(screen.queryByText('GitHub')).toBeNull();
  });

  it('safeOpenUrl is called with docsUrl when "Get token" is clicked', async () => {
    mockFetch.mockResolvedValue(connectorsResponse([
      makeConnector({ name: 'Stripe', docsUrl: 'https://docs.stripe.com', requiresToken: true }),
    ]));

    renderPage();
    await waitFor(() => screen.getByText('Stripe'));

    // Expand the card to reveal the connect form
    await userEvent.click(screen.getByText('Stripe'));

    // "Get token" link should appear in the expanded connect form
    await waitFor(() => expect(screen.getByText(/get token/i)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/get token/i));

    expect(mockOpenUrl).toHaveBeenCalledWith('https://docs.stripe.com');
  });

  it('safeOpenUrl is NOT called for non-https docsUrl', async () => {
    mockFetch.mockResolvedValue(connectorsResponse([
      makeConnector({ name: 'Stripe', docsUrl: 'javascript:alert(1)', requiresToken: true }),
    ]));

    renderPage();
    await waitFor(() => screen.getByText('Stripe'));
    await userEvent.click(screen.getByText('Stripe'));
    await waitFor(() => screen.getByText(/get token/i));
    await userEvent.click(screen.getByText(/get token/i));

    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it('"Custom connector" button opens the custom panel', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /custom connector/i }));
    await userEvent.click(screen.getByRole('button', { name: /custom connector/i }));
    // Custom panel shows "My MCP server" placeholder in the name field
    expect(screen.getByPlaceholderText('My MCP server')).toBeInTheDocument();
  });

  it('shows empty state message when search finds nothing', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Stripe'));
    await userEvent.type(screen.getByPlaceholderText(/search connectors/i), 'xyznotfound');
    expect(screen.getByText('No connectors found.')).toBeInTheDocument();
  });

  it('OAuth connectors call onOpenSettings when clicked', async () => {
    mockFetch.mockResolvedValue(connectorsResponse([
      makeConnector({ id: 'oauth/google', name: 'Google', type: 'oauth', status: 'available', requiresToken: false }),
    ]));

    const { onOpenSettings } = renderPage();
    // Use getAllByText to handle multiple "Google" matches (category option + card)
    await waitFor(() => screen.getAllByText('Google'));
    // Click the connector card specifically (it renders as a button)
    const cards = screen.getAllByText('Google');
    const card = cards.find(el => el.tagName === 'P');
    await userEvent.click(card!.closest('div[role="button"], button') ?? card!);
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

// ── safeOpenUrl unit tests ────────────────────────────────────────────────────

describe('safeOpenUrl (via ConnectorsPage integration)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockOpenUrl.mockReset();
  });

  const safeUrlCases: [string, boolean][] = [
    ['https://docs.example.com', true],
    ['http://docs.example.com', true],
    ['javascript:alert(1)', false],
    ['file:///etc/passwd', false],
    ['data:text/html,<script>alert(1)</script>', false],
    ['ftp://example.com', false],
  ];

  for (const [url, shouldOpen] of safeUrlCases) {
    it(`${shouldOpen ? 'opens' : 'blocks'} "${url}"`, async () => {
      mockFetch.mockResolvedValue(connectorsResponse([
        makeConnector({ docsUrl: url, requiresToken: true }),
      ]));

      renderPage();
      await waitFor(() => screen.getByText('Stripe'));
      await userEvent.click(screen.getByText('Stripe'));
      await waitFor(() => screen.getByText(/get token/i));
      await userEvent.click(screen.getByText(/get token/i));

      if (shouldOpen) {
        expect(mockOpenUrl).toHaveBeenCalledWith(url);
      } else {
        expect(mockOpenUrl).not.toHaveBeenCalled();
      }
    });
  }
});
