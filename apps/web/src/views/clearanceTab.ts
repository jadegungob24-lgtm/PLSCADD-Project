/** Lets menu commands open a given tab of the Clearance workspace. */
export type ClearanceTab = 'survey' | 'tin' | 'wires' | 'galloping';
export const clearanceTabRequest: { next: ClearanceTab | null } = { next: null };
export function requestClearanceTab(tab: ClearanceTab) {
  clearanceTabRequest.next = tab;
  window.dispatchEvent(new CustomEvent('tlcad:cleartab', { detail: tab }));
}
