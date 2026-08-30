import { CheckCircle2, Circle, Loader2, XCircle, AlertTriangle, ArrowRight } from "lucide-react";
import { cls } from "../../../lib/cls";
import type { PipelineStep, PipelineStatus } from "../types";
import styles from "./DeploymentPipeline.module.css";

interface DeploymentPipelineProps {
  steps: PipelineStep[];
  currentStep: string | null;
  onRun: () => void;
  running: boolean;
  disabled: boolean;
}

const STEP_ICONS: Record<PipelineStatus, typeof Circle> = {
  pending: Circle,
  active: Loader2,
  success: CheckCircle2,
  failed: XCircle,
  skipped: AlertTriangle,
};

const STATUS_COLORS: Record<PipelineStatus, string> = {
  pending: "pending",
  active: "active",
  success: "success",
  failed: "failed",
  skipped: "skipped",
};

export default function DeploymentPipeline({
  steps,
  currentStep,
  onRun,
  running,
  disabled,
}: DeploymentPipelineProps) {
  const completedCount = steps.filter((s) => s.status === "success").length;
  const totalCount = steps.length;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h3>Deployment Pipeline</h3>
          <span className={styles.progress}>
            {completedCount}/{totalCount} steps
          </span>
        </div>
        <button
          className={cls(styles.runBtn, running && styles.runBtnRunning)}
          onClick={onRun}
          disabled={disabled || running}
        >
          {running ? (
            <><Loader2 size={16} className={styles.spin} /> Deploying...</>
          ) : (
            <><ArrowRight size={16} /> Run Deployment</>
          )}
        </button>
      </div>

      {/* Progress bar */}
      <div className={styles.progressBar}>
        <div
          className={styles.progressFill}
          style={{ width: `${(completedCount / totalCount) * 100}%` }}
        />
      </div>

      {/* Steps */}
      <div className={styles.steps}>
        {steps.map((step, idx) => {
          const Icon = STEP_ICONS[step.status];
          const isCurrent = currentStep === step.id;
          return (
            <div
              key={step.id}
              className={cls(
                styles.step,
                styles[STATUS_COLORS[step.status]],
                isCurrent && styles.stepCurrent
              )}
            >
              <div className={styles.stepConnector}>
                <div className={styles.stepDot}>
                  <Icon
                    size={18}
                    className={cls(
                      step.status === "active" && styles.spin
                    )}
                  />
                </div>
                {idx < steps.length - 1 && <div className={styles.stepLine} />}
              </div>
              <div className={styles.stepContent}>
                <div className={styles.stepHeader}>
                  <span className={styles.stepLabel}>{step.label}</span>
                  {step.duration && (
                    <span className={styles.stepDuration}>{step.duration}</span>
                  )}
                </div>
                <p className={styles.stepDesc}>{step.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}