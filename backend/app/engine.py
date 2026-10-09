"""Observation-only policy. Evaluation labels never enter these functions."""
from datetime import datetime
import numpy as np

VERSION = "1.1.0"
GROUPS = [
    {"key": "identity", "label": "Identity consistency", "cap": 25},
    {"key": "device", "label": "Device signals", "cap": 25},
    {"key": "behaviour", "label": "Behaviour & anomalies", "cap": 30},
    {"key": "graph", "label": "Shared relationships", "cap": 20},
]


def seconds(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def summarise(p):
    events = p["events"]
    durations = [e["formSeconds"] for e in events if e.get("formSeconds") is not None]
    edits = [e["editCount"] for e in events if e.get("editCount") is not None]
    regional = [e for e in events if e.get("region") and p.get("declaredRegion")]
    return {"formSeconds": float(np.mean(durations)) if durations else None,
            "editCount": float(np.mean(edits)) if edits else None,
            "failedAttempts": sum(e.get("failedAttempts") or 0 for e in events),
            "mismatchRate": sum(e["region"] != p["declaredRegion"] for e in regional) / len(regional) if regional else 0,
            "sessionCount": len(events), "latest": events[-1]["timestamp"] if events else None,
            "devices": list(dict.fromkeys(e["deviceId"] for e in events))}


def fit_baseline(references):
    summaries = [summarise(p) for p in references]
    result = {"n": len(references)}
    for key in ("formSeconds", "editCount"):
        values = np.array([s[key] for s in summaries])
        centre = float(np.median(values))
        result[key] = {"median": centre, "mad": float(np.median(np.abs(values - centre))), "n": len(values)}
    return result


def robust_distance(value, reference, floor=1):
    return abs(value - reference["median"]) / max(floor, 1.4826 * reference["mad"])


class PopulationIndex:
    """Per-assessment-batch exact-token lookup; contains observations, never labels.

    Preserve population order in peer lists and deduplicate registrations by case ID.
    Never share this index between organisations or cache across changed evidence.
    """
    def __init__(self, population):
        self.tokens = {"device": {}, "address": {}, "phone": {}}
        self.created = {}
        for q in population:
            self.created[q["id"]] = seconds(q["createdAt"])
            summary = summarise(q)
            values = {"device": summary["devices"], "address": [q["addressToken"]], "phone": [q["phoneToken"]]}
            for kind, tokens in values.items():
                for token in dict.fromkeys(tokens):
                    if token:
                        self.tokens[kind].setdefault(token, []).append(q["id"])


def shared_entities(p, population, index=None):
    definitions = [("device", "Device", summarise(p)["devices"]),
                   ("address", "Address", [p["addressToken"]]),
                   ("phone", "Recovery phone", [p["phoneToken"]])]
    links = []
    for kind, label, tokens in definitions:
        for token in tokens:
            if not token:
                continue
            peers = ([peer for peer in index.tokens[kind].get(token, []) if peer != p["id"]] if index else
                     [q["id"] for q in population if q["id"] != p["id"] and
                      (token in summarise(q)["devices"] if kind == "device" else q["addressToken" if kind == "address" else "phoneToken"] == token)])
            if peers:
                links.append({"type": kind, "label": label, "value": token, "peers": peers})
    return links


def registration_burst(p, population, index=None):
    devices = set(summarise(p)["devices"])
    if index:
        peer_ids = {peer for device in devices for peer in index.tokens["device"].get(device, [])}
        times = sorted(index.created[peer] for peer in peer_ids)
    else:
        times = sorted(seconds(q["createdAt"]) for q in population if devices.intersection(summarise(q)["devices"]))
    left, maximum = 0, 0
    for right in range(len(times)):
        while times[right] - times[left] > 1800:
            left += 1
        maximum = max(maximum, right - left + 1)
    return {"count": maximum, "windowMinutes": 30, "total": len(times)}


def assess(p, population, baseline, excluded=(), index=None):
    if not p.get("events"):
        raise ValueError("A case requires at least one observation.")
    summary = summarise(p)
    links = shared_entities(p, population, index)
    conflicts = [key for key in ("birthYear", "declaredRegion") if len({r[key] for r in p["profileRecords"] if r.get(key) is not None}) > 1]
    burst = registration_burst(p, population, index)
    indicators = []

    def add(id, group, title, points, observed, reason, context):
        indicators.append(dict(id=id, group=group, title=title, points=points, observed=observed, reason=reason, context=context))

    email_days = (seconds(p["createdAt"]) - seconds(p["emailCreatedAt"])) / 86400 if p.get("emailCreatedAt") else None
    if email_days is not None and email_days < 30:
        add("new-email", "identity", "Recently created email", 7 if email_days < 7 else 4,
            f"{max(0, int(email_days))} days old at registration", "Limited email history adds a weak identity signal.",
            "New users also create new email accounts. This signal is never sufficient on its own.")
    if conflicts:
        labels = ["birth year" if k == "birthYear" else "declared region" for k in conflicts]
        add("profile-conflicts", "identity", "Conflicting profile attributes", min(18, 9 * len(conflicts)),
            f"{len(conflicts)} consistency checks failed: {', '.join(labels)}",
            "Synthetic profile fields disagree across the supplied registration and verification records.",
            "A failed consistency check can also result from a data-entry error.")
    if p["phoneVerified"] is False:
        add("unverified-phone", "identity", "Phone verification incomplete", 5, "No completed verification in the dataset",
            "The supplied contact channel has not been verified.", "Missing verification is an evidence gap, not proof of fraud.")
    most_peers = max([len(l["peers"]) for l in links if l["type"] == "device"] or [0])
    if most_peers:
        add("shared-device", "device", "Device used by multiple identities", 10 if most_peers >= 4 else 6 if most_peers >= 2 else 3,
            f"{most_peers + 1} identities share a device", "The same synthetic fingerprint is present on several accounts.",
            "Households and shared workstations can explain device reuse; related activity must corroborate it.")
    if p["emulatedDevice"]:
        add("emulator", "device", "Emulated device environment", 8, "Emulation flag present",
            "The supplied device telemetry indicates an emulated environment.", "Emulators also have legitimate accessibility and testing uses.")
    if p["deviceIntegrityMismatch"]:
        add("device-integrity", "device", "Device attributes conflict", 9, "Browser and platform attributes disagree",
            "The synthetic fingerprint reports incompatible platform attributes.", "One inconsistent attribute may be caused by browser privacy settings.")
    if summary["mismatchRate"] >= .35:
        add("region-mismatch", "behaviour", "Repeated region inconsistency", 7 if summary["mismatchRate"] >= .7 else 4,
            f"{int(summary['mismatchRate'] * 100 + .5)}% of sessions outside declared region",
            "Observed regions repeatedly differ from the declared region.", "Travel and network routing can explain location changes.")
    if summary["failedAttempts"] >= 4:
        add("failed-attempts", "behaviour", "Repeated unsuccessful sign-ins", 7 if summary["failedAttempts"] >= 12 else 4,
            f"{summary['failedAttempts']} failures across {summary['sessionCount']} sessions",
            "Repeated failed attempts accompany the observed activity.", "Credential mistakes can produce the same pattern.")
    if burst["count"] >= 3:
        add("registration-burst", "behaviour", "Concentrated registration activity", 10 if burst["count"] >= 5 else 6,
            f"{burst['count']} identities registered within 30 minutes on shared devices",
            "A short registration burst corroborates shared-device activity.",
            "This measures registrations, not account age; shared-device evidence is scored separately.")
    duration = robust_distance(summary["formSeconds"], baseline["formSeconds"], 15) if summary["formSeconds"] is not None else 0
    edits = robust_distance(summary["editCount"], baseline["editCount"], 1) if summary["editCount"] is not None else 0
    anomaly = max(duration, edits)
    if anomaly >= 2.5:
        duration_text = str(int(summary['formSeconds'] + .5)) + "s" if summary['formSeconds'] is not None else "unknown duration"
        edits_text = f"{summary['editCount']:.1f}" if summary['editCount'] is not None else "unknown"
        add("behaviour-anomaly", "behaviour", "Unusual form-completion behaviour", 10 if anomaly >= 4 else 6,
            f"{duration_text} mean completion · {edits_text} field edits",
            "Completion or editing activity differs from the independent reference cohort.",
            "Fast completion alone may reflect familiarity or assistive tools.")
    for link in sorted(links, key=lambda l: 0 if l["type"] == "phone" else 1):
        n = len(link["peers"])
        if link["type"] == "phone":
            add("shared-phone", "graph", "Recovery contact reused", 12 if n >= 3 else 8 if n >= 2 else 4,
                f"{n + 1} identities use {link['value']}", "Several identities share the same recovery contact.",
                "A family contact may be shared legitimately. Inspect other links and timing.")
        if link["type"] == "address" and n >= 3:
            add("shared-address", "graph", "Address linked to many identities", 8 if n >= 5 else 5,
                f"{n + 1} identities claim {link['value']}", "The address links multiple identities in the synthetic network.",
                "Shared housing or offices can explain address reuse.")
    mitigations = []

    def mitigate(title, evidence):
        mitigations.append(dict(title=title, evidence=evidence))

    if not conflicts and any(sum(r.get(key) is not None for r in p["profileRecords"]) >= 2 for key in ("birthYear", "declaredRegion")):
        mitigate("Profile attributes are consistent", "All supplied profile consistency checks passed.")
    if p["phoneVerified"]:
        mitigate("Contact verification completed", "The supplied synthetic phone-verification status is completed.")
    if summary["mismatchRate"] < .2 and p.get("declaredRegion") and all(e.get("region") for e in p["events"]):
        mitigate("Location pattern is stable", f"{int((1 - summary['mismatchRate']) * 100 + .5)}% of sessions match the declared region.")
    if p["emulatedDevice"] is False and p["deviceIntegrityMismatch"] is False:
        mitigate("Device attributes are coherent", "No emulation or conflicting platform attributes observed.")
    if burst["count"] < 3:
        mitigate("No concentrated registration burst", "Shared-device registrations do not meet the 3-in-30-minute threshold.")
    active = [i for i in indicators if i["id"] not in excluded]
    groups = []
    for g in GROUPS:
        raw = sum(i["points"] for i in active if i["group"] == g["key"])
        groups.append({**g, "raw": raw, "score": min(g["cap"], raw)})
    score = sum(g["score"] for g in groups)
    band = "High" if score >= 60 else "Review" if score >= 25 else "Low"
    top = sorted(active, key=lambda i: -i["points"])[:3]
    if score == 0:
        explanation = "The supplied observations show consistent profile details, coherent device attributes and behaviour within the reference range. No configured risk indicators were triggered. This indicates low observed risk, not verified authenticity."
    else:
        lead = "Several corroborating signals support prioritised review" if band == "High" else "Mixed evidence warrants additional review" if band == "Review" else "The observed warning signals are limited"
        explanation = lead + ": " + ", ".join(i["title"].lower() for i in top) + ". "
        if mitigations:
            explanation += mitigations[0]["title"] + ". "
        explanation += "The assessment flags potential identity fraud; it does not establish that the identity is synthetic."
    return dict(id=p["id"], score=score, band=band, groups=groups, indicators=active, mitigations=mitigations,
                links=links, summary=summary, burst=burst, anomaly=dict(distance=anomaly, durationDistance=duration,
                editDistance=edits, referenceN=baseline["n"]), explanation=explanation, version=VERSION, excluded=list(excluded))


def evaluate(population, truth, baseline):
    tp = fp = tn = fn = review = 0
    for p in population:
        r = assess(p, population, baseline)
        predicted, actual = r["score"] >= 60, truth[p["id"]] == "suspicious"
        tp += predicted and actual
        fp += predicted and not actual
        fn += not predicted and actual
        tn += not predicted and not actual
        review += r["band"] == "Review"
    return dict(tp=tp, fp=fp, tn=tn, fn=fn, precision=tp / (tp + fp or 1), recall=tp / (tp + fn or 1),
                falsePositiveRate=fp / (fp + tn or 1), n=len(population), reviewCount=review)
