/** Lets menu commands open a given tab of the Sag-Tension workspace. */
export type SagTab = 'table' | 'limits' | 'stringing' | 'charts' | 'structures' | 'loads' | 'trace';
export const sagTabRequest: { next: SagTab | null } = { next: null };
export function requestSagTab(tab: SagTab) {
  sagTabRequest.next = tab;
  window.dispatchEvent(new CustomEvent('tlcad:sagtab', { detail: tab }));
}
