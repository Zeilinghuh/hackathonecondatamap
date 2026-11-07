"""Create a simple interactive world map to use as the simulation's base."""

from pathlib import Path

import plotly.graph_objects as go


def create_world_map() -> go.Figure:
    # An empty geographic trace creates the canvas for future simulation layers.
    figure = go.Figure(go.Scattergeo())
    figure.update_geos(
        projection_type="natural earth",
        showland=True,
        landcolor="#bfd3ad",
        showocean=True,
        oceancolor="#c4e2f2",
        showlakes=True,
        lakecolor="#c4e2f2",
        showrivers=True,
        rivercolor="#79b4d2",
        showcountries=True,
        countrycolor="#ffffff",
        showcoastlines=True,
        coastlinecolor="#71866b",
        showframe=False,
    )
    figure.update_layout(
        title={"text": "World map", "x": 0.5},
        margin={"l": 0, "r": 0, "t": 50, "b": 0},
        height=700,
        paper_bgcolor="#ffffff",
    )
    return figure


if __name__ == "__main__":
    output = Path(__file__).with_name("world_map.html")
    create_world_map().write_html(
        output,
        include_plotlyjs=True,
        config={
            "displaylogo": False,
            "scrollZoom": True,
            "topojsonURL": "https://cdn.plot.ly/",
        },
    )
    print(f"World map saved to {output}")
