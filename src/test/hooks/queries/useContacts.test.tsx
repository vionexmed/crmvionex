// @vitest-environment jsdom
// renderiza hook com @testing-library/react
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("@/hooks/useOrg", () => ({
  useOrg: () => ({ orgId: "org-test" }),
}));

const mockContactsApi = {
  list: vi.fn().mockResolvedValue({ data: [], count: 0 }),
  deleteMany: vi.fn().mockResolvedValue(undefined),
  updateStatus: vi.fn().mockResolvedValue(undefined),
  updateOwner: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/lib/api/contacts", () => ({
  PAGE_SIZE: 50,
  contactsApi: mockContactsApi,
}));

vi.mock("@/lib/api/activities", () => ({
  activitiesApi: {
    lastPerContact: vi.fn().mockResolvedValue(new Map()),
  },
}));

const { useContacts, useDeleteContacts, useUpdateContactOwner } = await import(
  "@/hooks/queries/useContacts"
);

// ── Helpers ──────────────────────────────────────────────────────────────────
function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("useContacts()", () => {
  beforeEach(() => { mockContactsApi.list.mockReset(); });

  it("is in loading state initially", () => {
    mockContactsApi.list.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useContacts(), { wrapper });
    expect(result.current.isLoading).toBe(true);
  });

  it("returns data after fetch resolves", async () => {
    const contacts = [{ id: "c-1", first_name: "Ana", last_name: "Silva" }];
    mockContactsApi.list.mockResolvedValue({ data: contacts, count: 1 });
    const { result } = renderHook(() => useContacts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toEqual(contacts);
    expect(result.current.data?.count).toBe(1);
  });

  it("is in error state when the API throws", async () => {
    mockContactsApi.list.mockRejectedValue(new Error("DB error"));
    const { result } = renderHook(() => useContacts(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("passes params to contactsApi.list", async () => {
    mockContactsApi.list.mockResolvedValue({ data: [], count: 0 });
    const params = { page: 1, search: "ana" };
    const { result } = renderHook(() => useContacts(params), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockContactsApi.list).toHaveBeenCalledWith("org-test", params);
  });
});

describe("useDeleteContacts()", () => {
  it("calls contactsApi.deleteMany with the given ids", async () => {
    mockContactsApi.deleteMany.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteContacts(), { wrapper });
    await result.current.mutateAsync({ ids: ["id-1", "id-2"] });
    expect(mockContactsApi.deleteMany).toHaveBeenCalledWith(["id-1", "id-2"], undefined);
  });

  /**
   * `comVinculos` apaga negócios e atividades junto. O default TEM de ser não
   * apagar: um chamador que esqueça o parâmetro não pode destruir histórico por
   * omissão.
   */
  it("não apaga vínculos por omissão", async () => {
    mockContactsApi.deleteMany.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteContacts(), { wrapper });
    await result.current.mutateAsync({ ids: ["id-1"] });
    const [, comVinculos] = mockContactsApi.deleteMany.mock.calls.at(-1)!;
    expect(comVinculos).toBeFalsy();
  });

  it("apaga vínculos quando pedido explicitamente", async () => {
    mockContactsApi.deleteMany.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteContacts(), { wrapper });
    await result.current.mutateAsync({ ids: ["id-1"], comVinculos: true });
    expect(mockContactsApi.deleteMany).toHaveBeenCalledWith(["id-1"], true);
  });
});

describe("useUpdateContactOwner()", () => {
  it("calls contactsApi.updateOwner with id and ownerId", async () => {
    mockContactsApi.updateOwner.mockResolvedValue(undefined);
    const { result } = renderHook(() => useUpdateContactOwner(), { wrapper });
    await result.current.mutateAsync({ id: "c-1", ownerId: "user-99" });
    expect(mockContactsApi.updateOwner).toHaveBeenCalledWith("c-1", "user-99");
  });
});
