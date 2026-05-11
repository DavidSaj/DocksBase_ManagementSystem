from .models import GlobalSearchIndex


def upsert(*, marina, target_model, target_id, search_text, display_label, display_sub='', screen, link_id=None):
    GlobalSearchIndex.objects.update_or_create(
        target_model=target_model,
        target_id=target_id,
        defaults=dict(
            marina=marina,
            search_text=search_text,
            display_label=display_label,
            display_sub=display_sub,
            screen=screen,
            link_id=link_id,
        ),
    )


def remove(target_model, target_id):
    GlobalSearchIndex.objects.filter(target_model=target_model, target_id=target_id).delete()
