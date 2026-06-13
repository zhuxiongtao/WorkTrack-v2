from collections import Counter
from sqlmodel import Session, select
from app.models.customer import Customer


INDUSTRY_GROUP_RULES: list[tuple[str, list[str]]] = [
    ("人工智能", ["AI", "ai", "大模型", "智能体", "Agent", "agent", "向量", "RAG", "rag", "MLOps", "AIGC", "aigc", "NLP", "nlp", "对话", "多模态"]),
    ("云计算", ["云", "Cloud", "cloud", "容器", "Kubernetes", "k8s", "IaaS", "PaaS", "SaaS", "Serverless", "DevOps", "devops", "CDN", "FinOps", "AIOps", "零信任", "WAF"]),
    ("企业服务", ["协同", "办公", "CRM", "ERP", "HR", "低代码", "无代码", "中台", "营销自动化", "MarTech"]),
    ("金融科技", ["金融", "支付", "银行", "保险", "证券", "基金", "FinTech", "fintech", "区块链", "Web3", "数字资产"]),
    ("半导体/芯片", ["半导体", "芯片", "EDA", "eda", "IC", "集成电路", "晶圆", "封测"]),
    ("新能源/汽车", ["新能源", "汽车", "出行", "电动", "充电", "碳中和", "储能", "光伏", "风电"]),
    ("电商/零售", ["电商", "零售", "跨境", "消费", "本地生活", "餐饮", "即时零售", "O2O"]),
    ("社交/内容", ["社交", "内容", "媒体", "短视频", "直播", "社区", "论坛"]),
    ("游戏/娱乐", ["游戏", "娱乐", "互动", "电竞", "动漫"]),
    ("教育", ["教育", "培训", "学习", "课程", "知识"]),
    ("医疗健康", ["医疗", "健康", "医药", "生物", "制药", "诊断", "数字医疗"]),
    ("物流/供应链", ["物流", "供应链", "仓储", "配送", "货运", "快递"]),
    ("网络安全", ["安全", "Security", "security", "攻防", "渗透", "漏洞"]),
    ("物联网/硬件", ["物联网", "IoT", "iot", "硬件", "智能家居", "穿戴", "传感器"]),
    ("通信/5G", ["通信", "5G", "6G", "运营商", "宽带", "光纤"]),
    ("政务/城市", ["政务", "城市", "政府", "公共", "智慧城市"]),
    ("工业/制造", ["工业", "制造", "工厂", "产线", "机器人", "自动化设备"]),
    ("航空航天", ["航空", "航天", "卫星", "低空", "飞行"]),
    ("农业/食品", ["农业", "食品", "种植", "养殖", "农机"]),
    ("广告/营销", ["广告", "营销", "投放", "流量", "品牌"]),
    ("人力资源", ["人力", "招聘", "人才", "薪酬", "猎头"]),
]


def classify_industry(industry: str) -> str:
    if not industry:
        return ""
    for group_name, keywords in INDUSTRY_GROUP_RULES:
        for kw in keywords:
            if kw in industry:
                return group_name
    return industry


def get_industry_aggregation_from_db(db: Session, visible_user_ids=None) -> dict:
    if visible_user_ids is None:
        query = select(Customer.industry).where(Customer.industry != None, Customer.industry != "")
    else:
        query = select(Customer.industry).where(
            Customer.industry != None, Customer.industry != "", Customer.user_id.in_(visible_user_ids)
        )
    all_industries = db.exec(query).all()
    detail_counts = Counter(all_industries)
    group_map: dict[str, list[dict]] = {}
    group_counts: dict[str, int] = {}
    for ind, cnt in detail_counts.items():
        group = classify_industry(ind)
        if group not in group_map:
            group_map[group] = []
            group_counts[group] = 0
        group_map[group].append({"name": ind, "count": cnt})
        group_counts[group] += cnt
    for group in group_map:
        group_map[group].sort(key=lambda x: x["count"], reverse=True)
    result = []
    for group in sorted(group_map.keys(), key=lambda g: group_counts[g], reverse=True):
        result.append({
            "group": group,
            "count": group_counts[group],
            "industries": group_map[group],
        })
    return {"groups": result, "total_customers_with_industry": sum(detail_counts.values())}


def get_industry_categories_for_ai(db: Session) -> list[str]:
    industry_categories = []
    try:
        all_industries = db.exec(
            select(Customer.industry).where(Customer.industry != None, Customer.industry != "")
        ).all()
        ind_counts = Counter(all_industries)
        seen_groups = set()
        for ind in sorted(ind_counts.keys(), key=lambda x: ind_counts[x], reverse=True):
            group = classify_industry(ind)
            if group not in seen_groups:
                seen_groups.add(group)
                industry_categories.append(group)
            if ind != group and ind not in industry_categories:
                industry_categories.append(ind)
    except Exception:
        pass
    return industry_categories
