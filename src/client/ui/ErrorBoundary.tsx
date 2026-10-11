/**
 * A render error stays inside the part that threw (owner, 2026-10-11: the Boxels screen went blank again on
 * fast scrolling and only Ctrl+R brought it back). Without a boundary React unmounts everything above the
 * error and the screen is left empty with nothing to say why; with it the rest of the screen stays, the part
 * says what went wrong, and a button draws it again.
 */
import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null; tries: number }> {
  state = { error: null as Error | null, tries: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[edexo-compare] ${this.props.label} failed to draw:`, error, info.componentStack);
  }

  render() {
    // Keyed, so "Draw it again" mounts it afresh rather than reusing the state that threw.
    if (!this.state.error) return <Fragment key={this.state.tries}>{this.props.children}</Fragment>;
    return (
      <div className="error-boundary" role="alert">
        <p>
          <strong>{this.props.label} could not be drawn.</strong> {this.state.error.message}
        </p>
        <button type="button" className="btn secondary tiny" onClick={() => this.setState((s) => ({ error: null, tries: s.tries + 1 }))}>
          Draw it again
        </button>
      </div>
    );
  }
}
