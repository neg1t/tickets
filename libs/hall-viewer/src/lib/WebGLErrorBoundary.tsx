import { Component, type ReactNode } from 'react';

type Props = Readonly<{
  children: ReactNode;
  onError: (error: Error) => void;
}>;

type State = Readonly<{ failed: boolean }>;

export class WebGLErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    this.props.onError(error);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
