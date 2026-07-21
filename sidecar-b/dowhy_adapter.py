"""
Sidecar-B DoWhy + EconML 因果推断适配器（v1.5 真实集成）

v1.5 目标：
- 真实集成 dowhy==0.11 + econml==0.15
- 支持四步工作流：建模 → 识别 → 估计 → 反驳
- 支持 ATE（平均处理效应）和 CATE（条件平均处理效应）
- 失败时降级到占位实现

设计参考：
- DoWhy 0.11：四步因果推断框架（identify / estimate / refute）
- EconML 0.15：Double Machine Learning + Causal Forest
- PyWhy 官方教程：dowhy-conditional-treatment-effects.ipynb
"""
from typing import Any
from pydantic import BaseModel
import logging

logger = logging.getLogger("dowhy-adapter")

# ============================================================
# 尝试导入真实依赖
# ============================================================
_DOWHY_AVAILABLE = False
_ECONML_AVAILABLE = False

try:
    import dowhy
    from dowhy import CausalModel
    _DOWHY_AVAILABLE = True
    logger.info("DoWhy 真实库已加载（版本：%s）", getattr(dowhy, '__version__', 'unknown'))
except ImportError:
    logger.warning("DoWhy 未安装，将使用占位实现")

try:
    import econml
    from econml.dml import LinearDML, CausalForestDML
    from econml.dr import LinearDRLearner
    _ECONML_AVAILABLE = True
    logger.info("EconML 真实库已加载（版本：%s）", getattr(econml, '__version__', 'unknown'))
except ImportError:
    logger.warning("EconML 未安装，CATE 估计将降级到线性回归")


# ============================================================
# Pydantic 模型
# ============================================================

class CausalRequest(BaseModel):
    """因果推断请求"""
    treatment: str
    outcome: str
    confounders: list[str] = []
    effect_modifiers: list[str] = []
    data: list[dict[str, Any]]
    method: str = "backdoor"
    estimate_method: str = "linear"


class CausalResponse(BaseModel):
    """因果推断响应"""
    effect: float
    confidence: float
    method: str
    graph_summary: str
    reasoning: list[str]
    cate: list[dict[str, Any]] | None = None
    refutation: dict[str, Any] | None = None


# ============================================================
# DoWhy 适配器
# ============================================================

class DoWhyAdapter:
    """DoWhy + EconML 因果推断适配器"""

    def __init__(self):
        self._dowhy_available = _DOWHY_AVAILABLE
        self._econml_available = _ECONML_AVAILABLE
        logger.info(
            "DoWhy 适配器初始化完成（dowhy=%s, econml=%s）",
            self._dowhy_available,
            self._econml_available,
        )

    async def causal_analyze(self, req: CausalRequest) -> CausalResponse:
        """
        因果推断主入口

        四步工作流：
        1. 建模：构建因果图（DAG）
        2. 识别：识别可估计的因果效应
        3. 估计：计算 ATE / CATE
        4. 反驳：验证结果鲁棒性
        """
        if not req.data:
            raise ValueError("data 不能为空")

        # 如果 DoWhy 不可用，降级到占位实现
        if not self._dowhy_available:
            return self._placeholder_response(req)

        try:
            import pandas as pd
            df = pd.DataFrame(req.data)

            # ============================================================
            # 步骤 1：建模
            # ============================================================
            # 构建简单 DAG：confounders → treatment → outcome
            # confounders → outcome
            # effect_modifiers → outcome
            #
            # DoWhy 支持 DOT 和 GML 两种图格式。
            # 这里使用 DOT 格式，更直观且对变量名更宽容。
            edges = []
            for c in req.confounders:
                edges.append(f'    "{c}" -> "{req.treatment}"')
                edges.append(f'    "{c}" -> "{req.outcome}"')
            edges.append(f'    "{req.treatment}" -> "{req.outcome}"')
            for em in req.effect_modifiers:
                edges.append(f'    "{em}" -> "{req.outcome}"')

            dot_graph = "digraph {\n" + "\n".join(edges) + "\n}"

            logger.info(
                "DoWhy 建模：treatment=%s, outcome=%s, confounders=%d, graph_edges=%d",
                req.treatment,
                req.outcome,
                len(req.confounders),
                len(edges),
            )

            model = CausalModel(
                data=df,
                treatment=req.treatment,
                outcome=req.outcome,
                graph=dot_graph,
            )

            # ============================================================
            # 步骤 2：识别
            # ============================================================
            identified_estimand = model.identify_effect(proceed_when_unidentifiable=True)

            logger.info("DoWhy 识别完成：%s", identified_estimand)

            # ============================================================
            # 步骤 3：估计
            # ============================================================
            # 选择估计方法
            if req.estimate_method == "dml" and self._econml_available:
                method_name = "backdoor.econml.dml.LinearDML"
                method_params = {
                    "init_params": {
                        "model_y": "linear",
                        "model_t": "linear",
                    }
                }
            elif req.estimate_method == "dr" and self._econml_available:
                method_name = "backdoor.econml.dr.LinearDRLearner"
                method_params = {
                    "init_params": {
                        "model_y": "linear",
                        "model_t": "linear",
                    }
                }
            elif req.estimate_method == "forest" and self._econml_available:
                method_name = "backdoor.econml.dml.CausalForestDML"
                method_params = {
                    "init_params": {
                        "model_y": "linear",
                        "model_t": "linear",
                        "n_estimators": 100,
                        "min_samples_leaf": 10,
                    }
                }
            else:
                # 默认线性回归
                method_name = "backdoor.linear_regression"
                method_params = {}

            estimate = model.estimate_effect(
                identified_estimand,
                method_name=method_name,
                method_params=method_params,
            )

            effect_value = float(estimate.value)
            logger.info("DoWhy 估计完成：effect=%.4f, method=%s", effect_value, method_name)

            # ============================================================
            # 步骤 4：反驳（可选）
            # ============================================================
            refutation_result = None
            try:
                # 随机化测试：如果 treatment 是随机的，效应应该接近 0
                refutation = model.refute_estimate(
                    identified_estimand,
                    estimate,
                    method_name="random_common_cause",
                )
                refutation_result = {
                    "method": "random_common_cause",
                    "new_effect": float(refutation.new_effect) if hasattr(refutation, 'new_effect') else None,
                    "original_effect": effect_value,
                }
                logger.info("DoWhy 反驳完成：%s", refutation_result)
            except Exception as e:
                logger.warning("DoWhy 反驳失败：%s", e)
                refutation_result = {"error": str(e)}

            # ============================================================
            # CATE（条件平均处理效应，可选）
            # ============================================================
            cate_result = None
            if req.effect_modifiers and self._econml_available and req.estimate_method in ["dml", "forest"]:
                try:
                    cate_result = self._estimate_cate(model, identified_estimand, req, df)
                except Exception as e:
                    logger.warning("CATE 估计失败：%s", e)

            # ============================================================
            # 构建响应
            # ============================================================
            # 计算置信度：基于反驳结果
            confidence = 0.8
            if refutation_result and "new_effect" in refutation_result and refutation_result["new_effect"] is not None:
                # 如果随机化后效应接近 0，说明原效应可信
                new_eff = abs(refutation_result["new_effect"])
                orig_eff = abs(effect_value)
                if orig_eff > 0:
                    confidence = min(0.95, max(0.5, 1.0 - new_eff / (orig_eff + 1e-9)))
                else:
                    confidence = 0.5

            return CausalResponse(
                effect=effect_value,
                confidence=confidence,
                method=f"dowhy-{req.estimate_method}",
                graph_summary=f"DAG：treatment={req.treatment} -> outcome={req.outcome}",
                reasoning=[
                    f"treatment={req.treatment}, outcome={req.outcome}",
                    f"confounders={len(req.confounders)}, effect_modifiers={len(req.effect_modifiers)}",
                    f"method={method_name}",
                    f"effect={effect_value:.4f}",
                    f"refutation={'passed' if refutation_result and 'error' not in refutation_result else 'failed'}",
                ],
                cate=cate_result,
                refutation=refutation_result,
            )

        except Exception as e:
            logger.exception("DoWhy 因果推断失败")
            # 降级到占位实现
            return self._placeholder_response(req, error=str(e))

    def _estimate_cate(
        self,
        model: Any,
        identified_estimand: Any,
        req: CausalRequest,
        df: Any,
    ) -> list[dict[str, Any]] | None:
        """估计条件平均处理效应（CATE）"""
        try:
            from econml.dml import CausalForestDML

            # 准备数据
            X = df[req.effect_modifiers].values if req.effect_modifiers else df[[req.treatment]].values
            T = df[req.treatment].values
            Y = df[req.outcome].values
            W = df[req.confounders].values if req.confounders else None

            # 训练 Causal Forest
            forest = CausalForestDML(
                model_y="linear",
                model_t="linear",
                n_estimators=100,
                min_samples_leaf=10,
                random_state=42,
            )
            forest.fit(Y, T, X=X, W=W)

            # 预测 CATE
            cate_pred = forest.effect(X)
            cate_result = []
            for i, effect in enumerate(cate_pred[:20]):  # 限制返回前 20 条
                cate_result.append({
                    "index": i,
                    "effect": float(effect),
                    "features": {k: float(df[k].iloc[i]) for k in req.effect_modifiers} if req.effect_modifiers else {},
                })

            logger.info("CATE 估计完成：%d 条", len(cate_result))
            return cate_result

        except Exception as e:
            logger.warning("CATE 估计失败：%s", e)
            return None

    def _placeholder_response(self, req: CausalRequest, error: str | None = None) -> CausalResponse:
        """降级到占位响应"""
        reasoning = [
            f"v1.5 占位：未集成真实 DoWhy" if not self._dowhy_available else f"DoWhy 失败：{error}",
            f"参数：treatment={req.treatment}, outcome={req.outcome}",
            f"confounders={len(req.confounders)}, data_rows={len(req.data)}",
            "v1.6 升级计划：真实 DoWhy + EconML 四步工作流",
        ]
        return CausalResponse(
            effect=0.0,
            confidence=0.5,
            method="dowhy-placeholder-v1.5",
            graph_summary=f"占位图：{req.treatment} -> {req.outcome}（{len(req.confounders)} 混杂因子）",
            reasoning=reasoning,
        )


# ============================================================
# 单例
# ============================================================

_adapter: DoWhyAdapter | None = None


def get_dowhy_adapter() -> DoWhyAdapter:
    global _adapter
    if _adapter is None:
        _adapter = DoWhyAdapter()
    return _adapter
