const mockFetch = jest.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: async () => ({}),
  text: async () => '',
});

export default mockFetch;
export { mockFetch as fetch };
