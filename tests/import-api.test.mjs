import test from "node:test";
import assert from "node:assert/strict";

const sampleHtml = `<!doctype html><html><body>
  <a href="/wczasy/turcja/side/crystal-family-resort-h12345.html">
    <h3>Crystal Family Resort</h3>
    <img src="https://images.example/crystal.webp" />
    <p>Side · 5 gwiazdek · Ultra All Inclusive · Coral Travel</p>
    <p>25.08.2026 - 31.08.2026 (6 nocy)</p>
    <p>4,7 Bardzo dobry · aquapark i zjeżdżalnie · bezpośrednio przy plaży</p>
    <strong>od 27 840 zł</strong>
  </a>
  <a href="/wczasy/turcja/belek/paloma-family-club-h67890.html">
    <h3>Paloma Family Club</h3>
    <p>Belek · 5 gwiazdek · All Inclusive · Itaka</p>
    <p>25.08.2026 - 31.08.2026 (6 nocy)</p>
    <p>4,5 Dobry · przy plaży</p>
    <strong>24 990 zł</strong>
  </a>
</body></html>`;

test("import API parses real fields without inventing missing values", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("wakacje.pl")) {
      return new Response(sampleHtml, {
        status: 200,
        headers: { "Content-Type": "text/html", "Content-Length": String(sampleHtml.length) },
      });
    }
    return originalFetch(input);
  };
  try {
    const { default: worker } = await import("../dist/server/index.js");
    const response = await worker.fetch(new Request("http://local/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: "https://www.wakacje.pl/wczasy/turcja/?od-2026-08-25,do-2026-08-31,6-dni,do-30000zl,z-warszawy,2dorosle-3dzieci",
      }),
    }), {}, { waitUntil() {}, passThroughOnException() {} });
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const body = JSON.parse(responseText);
    assert.equal(body.offers.length, 2);
    assert.equal(body.offers[0].name, "Crystal Family Resort");
    assert.equal(body.offers[0].price, 27840);
    assert.equal(body.offers[0].ratings.wakacje.value, 4.7);
    assert.equal(body.offers[0].ratings.google.value, null);
    assert.equal(body.offers[0].aquapark.value, null);
    assert.equal(body.offers[0].aquaparkPresent.value, true);
    assert.equal(body.offers[0].aquaparkPresent.confidence, "confirmed");
    assert.equal(body.trip.maxPrice, 30000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("import API parses the current Wakacje.pl displayOffers format", async () => {
  const displayOffers = {
    0: {
      cid: 15957,
      cofrcountry: "Turcja",
      cofrname: "Club Side Coast",
      cofrdepdate: "2026-08-25",
      cofrservice: "All Inclusive",
      cofrstars: 5,
      cofrtourop: "Coral Travel",
      cofrrating: "7.2",
      cofractualprice: 17944,
    },
  };
  const payload = JSON.stringify({
    displayOffers: JSON.stringify(displayOffers),
    filters: JSON.stringify({ adults: 2, kids: 3, attributes: ["26", "21"] }),
  });
  const currentHtml = `<!doctype html><html><body>
    <script type="application/ld+json">${JSON.stringify({
      "@type": "ItemList",
      itemListElement: [{
        "@type": "ListItem",
        position: 1,
        name: "Club Side Coast",
        url: "https://www.wakacje.pl/oferty/turcja/riwiera-turecka/club-side-coast-15957.html",
      }],
    })}</script>
    <a data-test-offer-id="15957" href="/oferty/turcja/riwiera-turecka/club-side-coast-15957.html">
      <img src="https://i.wakacje.pl/no-index/hotel/club-side-coast-343-228.jpg" />
    </a>
    <script>r('wp.show', [${payload}, "listing"])</script>
  </body></html>`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(currentHtml, {
    status: 200,
    headers: { "Content-Type": "text/html", "Content-Length": String(currentHtml.length) },
  });
  try {
    const { default: worker } = await import("../dist/server/index.js");
    const response = await worker.fetch(new Request("http://local/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: "https://www.wakacje.pl/wczasy/turcja/?od-2026-08-25,do-2026-08-31,6-dni,do-30000zl,przy-plazy,z-aquaparkiem,z-warszawy,2dorosle-3dzieci",
      }),
    }), {}, { waitUntil() {}, passThroughOnException() {} });
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const body = JSON.parse(responseText);
    assert.equal(body.offers.length, 1);
    assert.equal(body.offers[0].name, "Club Side Coast");
    assert.equal(body.offers[0].price, 17944);
    assert.equal(body.offers[0].ratings.wakacje.value, 7.2);
    assert.equal(body.offers[0].location, "Riwiera Turecka");
    assert.equal(body.offers[0].aquapark.value, null);
    assert.equal(body.offers[0].aquaparkPresent.value, true);
    assert.equal(body.offers[0].beach.value, true);
    assert.match(body.offers[0].sourceUrl, /club-side-coast-15957\.html/);
    assert.match(body.offers[0].image, /club-side-coast-343-228\.jpg/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("research API is safely disabled without server credentials", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const response = await worker.fetch(new Request("http://local/api/research"), {}, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { available: false });
});
