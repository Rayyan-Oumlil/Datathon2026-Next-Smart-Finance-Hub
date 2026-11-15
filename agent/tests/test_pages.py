"""Which page the app opens for each kind of proposal, so the reply can name the right one."""
from app import orchestrator

LIBRARY = [
    {"id": "total_value", "tab": "portfolio"}, {"id": "xray", "tab": "portfolio"},
    {"id": "overview_heatmap", "tab": "overview"}, {"id": "overview_news", "tab": "overview"},
]
CURRENT = ["total_value", "xray", "overview_heatmap", "overview_news"]
LAYOUT = {"current": CURRENT, "library": LIBRARY}


def test_changes_that_have_a_page():
    assert orchestrator.page_for("strategy_propose", {}, None) == "Strategy"
    assert orchestrator.page_for("profile_change", {}, None) == "Profile"
    assert orchestrator.page_for("rule_create", {}, None) == "Portfolio"
    assert orchestrator.page_for("rule_pause", {}, None) == "Portfolio"


def test_a_trade_stays_in_the_chat():
    assert orchestrator.page_for("simulated_trade", {}, None) is None


def test_a_layout_change_goes_to_the_page_of_the_widgets_it_touches():
    hide_heatmap = {"layout": ["total_value", "xray", "overview_news"]}
    assert orchestrator.page_for("layout_change", hide_heatmap, LAYOUT) == "Overview"
    hide_xray = {"layout": ["total_value", "overview_heatmap", "overview_news"]}
    assert orchestrator.page_for("layout_change", hide_xray, LAYOUT) == "Portfolio"
    # Both tabs: the Portfolio, where the other half is
    both = {"layout": ["total_value", "overview_news"]}
    assert orchestrator.page_for("layout_change", both, LAYOUT) == "Portfolio"
    # Without the layout the model was given, nothing is claimed
    assert orchestrator.page_for("layout_change", hide_heatmap, None) is None
