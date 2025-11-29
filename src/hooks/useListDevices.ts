import { useQuery } from "@tanstack/react-query";
import { listDevices } from "../lib/QuietDuplex";

export function useListDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: listDevices,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
