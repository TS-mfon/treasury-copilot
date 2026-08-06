export function shouldBlockSetupNavigation(options: {
  walletConnected: boolean;
  sessionAuthenticated: boolean;
  sessionOwner?: string | null;
  walletAddress?: string | null;
}) {
  if (!options.walletConnected) return false;
  if (!options.sessionAuthenticated) return true;
  if (!options.sessionOwner || !options.walletAddress) return true;
  return options.sessionOwner.toLowerCase() !== options.walletAddress.toLowerCase();
}
