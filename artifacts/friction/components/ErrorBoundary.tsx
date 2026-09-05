import React, { Component, ComponentType, PropsWithChildren } from "react";

import { ErrorFallback, ErrorFallbackProps } from "@/components/ErrorFallback";
import {
  reportRenderError,
} from "@/lib/crashDiagnostics";
import {
  getComponentStackDiagnostic,
  getRenderDiagnostic,
  type RenderDiagnosticCode,
} from "@/lib/renderErrorDiagnostics";

export type ErrorBoundaryProps = PropsWithChildren<{
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  onError?: (error: Error, stackTrace: string) => void;
}>;

type ErrorBoundaryState = {
  error: Error | null;
  diagnosticCode: RenderDiagnosticCode | null;
};

/**
 * This is a special case for for using the class components. Error boundaries must be class components because React only provides error boundary functionality through lifecycle methods (componentDidCatch and getDerivedStateFromError) which are not available in functional components.
 * https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, diagnosticCode: null };

  static defaultProps: {
    FallbackComponent: ComponentType<ErrorFallbackProps>;
  } = {
    FallbackComponent: ErrorFallback,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error,
      diagnosticCode: getRenderDiagnostic(error).diagnosticCode,
    };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    const componentDiagnostic = getComponentStackDiagnostic(info.componentStack);
    reportRenderError(error, componentDiagnostic);
    if (typeof this.props.onError === "function") {
      this.props.onError(error, info.componentStack);
    }
  }

  resetError = (): void => {
    this.setState({ error: null, diagnosticCode: null });
  };

  render() {
    const { FallbackComponent } = this.props;

    return this.state.error && FallbackComponent ? (
      <FallbackComponent
        error={this.state.error}
        diagnosticCode={this.state.diagnosticCode}
        resetError={this.resetError}
      />
    ) : (
      this.props.children
    );
  }
}
