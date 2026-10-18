import { test } from "node:test";
import assert from "node:assert/strict";
import { forbiddenHost, isAllowedHost, requestHostname } from "./host-guard";

test("local and private hosts are allowed", () => {
  for (const host of ["localhost", "127.0.0.1", "127.1.2.3", "10.0.0.8", "192.168.1.40", "172.16.0.1", "172.31.255.9", "kindle.local", "[::1]", "[fd00::8]", "[fe80::1a2b]"]) {
    assert.equal(isAllowedHost(host), true, host);
  }
});

test("public names and addresses are rejected", () => {
  for (const host of ["evil.com", "localhost.evil.com", "8.8.8.8", "172.32.0.1", "192.169.1.1", "10.0.0.256", "1.1.1.1.evil.com", "[2606:4700::1111]"]) {
    assert.equal(isAllowedHost(host), false, host);
  }
});

test("BETTER_KINDLE_ALLOWED_HOSTS opens exactly the listed names", () => {
  assert.equal(isAllowedHost("books.example.com", "books.example.com"), true);
  assert.equal(isAllowedHost("books.example.com", "other.example.com, books.example.com"), true);
  assert.equal(isAllowedHost("books.example.com", "other.example.com"), false);
  assert.equal(isAllowedHost("evil.com", ""), false);
});

test("the host header is read with its port stripped, IPv6 literals kept", () => {
  const request = (host: string) => new Request("http://localhost/api/pdfs", { headers: { host } });
  assert.equal(requestHostname(request("127.0.0.1:3000")), "127.0.0.1");
  assert.equal(requestHostname(request("Evil.COM:3210")), "evil.com");
  assert.equal(requestHostname(request("[::1]:3000")), "[::1]");
  assert.equal(requestHostname(request("[fd00::1]")), "[fd00::1]");
  // Node's Request does not synthesize Host; a real HTTP request always has one,
  // and a missing host must fail closed rather than pass.
  assert.equal(requestHostname(new Request("http://localhost/api/pdfs")), "");
});

test("forbiddenHost answers 403 only for foreign hosts", async () => {
  const response = forbiddenHost(new Request("http://localhost/api/pdfs", { headers: { host: "evil.com" } }));
  assert.equal(response?.status, 403);
  assert.match(await response!.text(), /Host: evil\.com/);
  assert.equal(forbiddenHost(new Request("http://localhost/api/pdfs", { headers: { host: "localhost:3000" } })), null);
});
