import { createContext } from "react";

// Public pages explicitly opt into guest access, even when a signer is installed.
export const GuestAccess = createContext<(() => void) | undefined>(undefined);
