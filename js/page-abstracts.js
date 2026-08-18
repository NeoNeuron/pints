import { mountLayout, setAuthLink } from "./layout.js";
import { warnIfUnconfigured } from "./firebase.js";
import { onUser } from "./auth.js";
import { getPublicAbstract, listPublicAbstracts } from "./db.js";
import { filterAbstracts, sortPublicAbstracts } from "./abstract-utils.mjs";
import { abstractCard, abstractPermalink } from "./abstract-card.js";
import { ABSTRACT_TOPICS, SITE_NAME, TOPIC_LABELS } from "./config.mjs";
import { hydrateMarkdownHosts } from "./content-hydrate.js";

mountLayout();
onUser(({ user, isAdmin }) => setAuthLink({ signedIn: Boolean(user), isAdmin }));

const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const msg = document.getElementById("msg");
const queryEl = document.getElementById("q");
const topicEl = document.getElementById("topic");
const filtersEl = document.getElementById("filters");
const guidelinesEl = document.getElementById("guidelines");
const headingEl = document.querySelector("main h1");

// ?a=<id> asks for one abstract by itself, which is what a shared link is. The
// list is the default, so an absent or unknown parameter degrades to it rather
// than to an error page.
const wanted = new URLSearchParams(location.search).get("a");

if (wanted) await mountOne(wanted);
else await mountList();

/** A shared link: one abstract, no filters, and a way back to the rest. */
async function mountOne(id) {
  // The poster guidelines are advice for people about to submit, not context for
  // a shared abstract, so this view drops them rather than hydrating them.
  guidelinesEl.remove();
  filtersEl.hidden = true;
  countEl.hidden = true;

  if (warnIfUnconfigured(msg)) return;
  try {
    const abstract = await getPublicAbstract(id);
    if (!abstract) {
      headingEl.textContent = "Abstract not found";
      msg.className = "msg warn";
      // Deliberately vague about which: abstracts_public holds only accepted
      // ones, so "no such abstract" and "not accepted (yet)" are the same read,
      // and guessing between them would leak a decision that is not ours to
      // announce.
      msg.textContent = "That abstract is not in the public list. Only accepted "
        + "abstracts are published here.";
      listEl.append(backLink());
      return;
    }
    // The card's own heading becomes the page heading, rather than printing the
    // title twice: it is the same string, and only the card's version carries
    // the poster number and the talk pill.
    headingEl.remove();
    // The tab and any link preview should name the abstract, not the section.
    document.title = `${abstract.title ?? "Abstract"} — ${SITE_NAME}`;
    listEl.replaceChildren(
      abstractCard(abstract, { headingLevel: "h1" }),
      backLink(),
    );
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "Could not load that abstract.";
    console.error("[pints] abstract", err);
  }
}

function backLink() {
  const p = document.createElement("p");
  const a = document.createElement("a");
  a.href = "abstracts.html";
  a.textContent = "← All abstracts";
  p.append(a);
  return p;
}

async function mountList() {
  await hydrateMarkdownHosts();

  const anyTopic = document.createElement("option");
  anyTopic.value = "";
  anyTopic.textContent = "All topics";
  topicEl.append(anyTopic);
  for (const topic of ABSTRACT_TOPICS) {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = TOPIC_LABELS[topic] ?? topic;
    topicEl.append(option);
  }

  if (warnIfUnconfigured(msg)) return;

  let all = [];
  const draw = () => {
    const byTopic = topicEl.value ? all.filter((a) => a.topic === topicEl.value) : all;
    const shown = filterAbstracts(byTopic, queryEl.value);
    countEl.textContent = `${shown.length} of ${all.length} shown.`;
    listEl.replaceChildren(...shown.map((a) =>
      abstractCard(a, { permalink: abstractPermalink(a.id) })));
  };

  try {
    all = sortPublicAbstracts(await listPublicAbstracts());
    if (!all.length) {
      msg.className = "msg warn";
      msg.textContent = "No abstracts have been accepted yet.";
    }
    draw();
    queryEl.addEventListener("input", draw);
    topicEl.addEventListener("change", draw);
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "Could not load the abstract list.";
    console.error("[pints] abstracts", err);
  }
}
