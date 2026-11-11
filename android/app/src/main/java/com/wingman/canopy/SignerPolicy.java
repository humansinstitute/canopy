package com.wingman.canopy;

import java.net.URI;
import java.util.Set;

/** Pure policy shared by the host and local tests. No arbitrary intent forwarding. */
public final class SignerPolicy {
    public static final String ORIGIN = "https://appassets.androidplatform.net";
    public static final String AMBER = "com.greenart7c3.nostrsigner";
    private static final Set<String> METHODS = Set.of("get_public_key", "sign_event", "nip44_encrypt", "nip44_decrypt");
    public static boolean trusted(String value) {
        try {
            URI uri = URI.create(value);
            return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost()) && uri.getPort() == -1 && uri.getUserInfo() == null;
        } catch (RuntimeException e) { return false; }
    }
    public static boolean key(String value) { return value != null && value.matches("[0-9a-f]{64}"); }
    public static boolean method(String value) { return METHODS.contains(value); }
    public static boolean external(String value) {
        try { return Set.of("https", "http", "lightning", "mailto").contains(URI.create(value).getScheme()); }
        catch (RuntimeException e) { return false; }
    }
}
