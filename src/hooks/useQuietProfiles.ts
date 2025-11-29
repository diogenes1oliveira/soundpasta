import { useQuery } from "@tanstack/react-query";

export interface QuietProfile {
  [key: string]: unknown;
}

export interface QuietProfiles {
  [profileName: string]: QuietProfile;
}

async function fetchQuietProfiles(): Promise<QuietProfiles> {
  const response = await fetch("/quietjs/quiet-profiles.json");
  if (!response.ok) {
    throw new Error(`Failed to fetch profiles: ${response.statusText}`);
  }
  return response.json();
}

export function useQuietProfiles() {
  return useQuery({
    queryKey: ["quiet-profiles"],
    queryFn: fetchQuietProfiles,
    staleTime: 1000 * 60 * 60, // 1 hour - profiles don't change often
  });
}

