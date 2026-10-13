import { Component } from 'react'
import { TriangleAlert } from 'lucide-react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[React Error Boundary Catched Error]', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="crash-screen" role="alert">
          <div className="card crash-card">
            <span className="crash-icon" aria-hidden="true">
              <TriangleAlert size={32} />
            </span>
            <h1>عذراً، حدث خطأ غير متوقع في النظام!</h1>
            <p>
              تسبب عطل مفاجئ في توقف واجهة البرنامج. يمكنك محاولة إعادة تحميل الصفحة أو التواصل مع
              الدعم الفني.
            </p>
            {this.state.error && (
              <pre className="crash-details ltr">{this.state.error.toString()}</pre>
            )}
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              onClick={this.handleReload}
            >
              إعادة تحميل البرنامج
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
