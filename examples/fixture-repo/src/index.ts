export function createOrder(customerId: string, items: string[]): { id: string } {
  return { id: `${customerId}-${items.length}` };
}
