import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import type { Assessment } from "./types";

export function Graph({
  result,
  results,
  onSelect,
}: {
  result: Assessment;
  results: Map<string, Assessment>;
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    instance = useRef<cytoscape.Core | null>(null);
  useEffect(() => {
    if (!container.current || !result.links.length) return;
    const elements: cytoscape.ElementDefinition[] = [
      {
        data: {
          id: result.id,
          label: `${result.id}\n${result.score}/100`,
          kind: "selected",
        },
        position: { x: 320, y: 55 },
      },
    ];
    const peers = [...new Set(result.links.flatMap((l) => l.peers))].slice(
      0,
      24,
    );
    result.links.forEach((link, i) => {
      const id = `entity-${i}`;
      elements.push(
        {
          data: { id, label: `${link.label}\n${link.value}`, kind: "entity" },
          position: { x: (640 * (i + 1)) / (result.links.length + 1), y: 160 },
        },
        { data: { id: `selected-${i}`, source: result.id, target: id } },
      );
      link.peers
        .filter((p) => peers.includes(p))
        .forEach((p) =>
          elements.push({
            data: { id: `edge-${i}-${p}`, source: id, target: p },
          }),
        );
    });
    peers.forEach((id, i) =>
      elements.push({
        data: {
          id,
          label: `${id}\n${results.get(id)?.score}/100`,
          kind: "peer",
          band: results.get(id)?.band,
        },
        position: { x: 110 + (i % 6) * 110, y: 280 + Math.floor(i / 6) * 85 },
      }),
    );
    const cy = cytoscape({
      container: container.current,
      elements,
      layout: { name: "preset", fit: true, padding: 40 },
      minZoom: 0.3,
      maxZoom: 2,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-wrap": "wrap",
            "text-valign": "center",
            "text-halign": "center",
            "font-family": "system-ui",
            "font-size": 12,
            "background-color": "#edf2f8",
            color: "#17243b",
            shape: "round-rectangle",
            width: 100,
            height: 48,
            "border-width": 1,
            "border-color": "#cbd5e3",
          },
        },
        {
          selector: 'node[kind="selected"]',
          style: {
            "background-color": "#1749bd",
            color: "white",
            width: 150,
            height: 60,
          },
        },
        {
          selector: 'node[kind="entity"]',
          style: { "background-color": "#eaf0ff", width: 175 },
        },
        {
          selector: 'node[band="High"]',
          style: { "border-color": "#b42d40", color: "#b42d40" },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#a7b8d5",
            "curve-style": "bezier",
          },
        },
      ],
    });
    instance.current = cy;
    cy.on("tap", 'node[kind="peer"]', (e) => onSelect(e.target.id()));
    const observer = new ResizeObserver(() => {
      cy.resize();
      cy.fit(undefined, 35);
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      cy.destroy();
      instance.current = null;
    };
  }, [result, results, onSelect]);
  if (!result.links.length)
    return (
      <div className="empty">
        No shared device, recovery phone or address links were found in this
        population.
      </div>
    );
  return (
    <>
      <div className="section-title">
        <h3>Shared-entity relationships</h3>
        <button
          className="btn"
          onClick={() => instance.current?.fit(undefined, 35)}
        >
          Fit graph
        </button>
      </div>
      <div
        ref={container}
        className="cy-graph"
        role="img"
        aria-label={`Relationship graph for ${result.id}. Accessible connections are listed below.`}
      />
      <p className="small muted graph-caption">
        Select a linked identity to investigate. Links show shared observations,
        not proof of fraud. Scores are not propagated.
      </p>
      {result.links.map((link, i) => (
        <div className="link-evidence" key={i}>
          <div>
            <strong>
              {link.label} · {link.value}
            </strong>
            <p>
              Shared with {link.peers.length} other identities:{" "}
              {link.peers.map((id) => (
                <button
                  className="text-link"
                  key={id}
                  onClick={() => onSelect(id)}
                >
                  {id}
                </button>
              ))}
            </p>
          </div>
          <span className="pill">{link.peers.length + 1} linked</span>
        </div>
      ))}
    </>
  );
}
