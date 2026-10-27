// lib/screens/saas/team_management_screen.dart
import 'package:glow_core/models/saas/saas_models.dart';
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class TeamManagementScreen extends ConsumerWidget {
  const TeamManagementScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final businessProfileState = ref.watch(businessProfileProvider);
    final teamState = ref.watch(teamProvider);
    final businessProfileId = ref.watch(currentBusinessProfileIdProvider);
    final businessProfile = businessProfileState.profile;

    // Carga inicial: el provider no se auto-carga al entrar a la pantalla.
    if (businessProfileId != null && teamState.members.isEmpty && !teamState.isLoading) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ref.read(teamProvider.notifier).load(businessProfileId);
      });
    }

    if (businessProfile == null) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Mi Equipo'),
          backgroundColor: const Color(0xFFFAF8F5),
          foregroundColor: const Color(0xFF1F1A15),
        ),
        body: const Center(child: Text('No hay perfil de negocio configurado')),
      );
    }

    return Scaffold(
          appBar: AppBar(
            title: const Text('Mi Equipo'),
            backgroundColor: const Color(0xFFFAF8F5),
            foregroundColor: const Color(0xFF1F1A15),
            elevation: 0,
            actions: [
              PopupMenuButton<String>(
                icon: const Icon(Icons.more_vert_rounded, color: Color(0xFFC5A052)),
                onSelected: (value) {
                  switch (value) {
                    case 'billing':
                      Navigator.pushNamed(context, '/saas/billing');
                      break;
                    case 'usage':
                      Navigator.pushNamed(context, '/saas/usage');
                      break;
                    case 'api_keys':
                      Navigator.pushNamed(context, '/saas/api-keys');
                      break;
                  }
                },
                itemBuilder: (ctx) => [
                  const PopupMenuItem(
                    value: 'billing',
                    child: Row(children: [Icon(Icons.receipt_long_rounded, size: 18), SizedBox(width: 8), Text('Facturación')]),
                  ),
                  const PopupMenuItem(
                    value: 'usage',
                    child: Row(children: [Icon(Icons.analytics_rounded, size: 18), SizedBox(width: 8), Text('Uso y Métricas')]),
                  ),
                  const PopupMenuItem(
                    value: 'api_keys',
                    child: Row(children: [Icon(Icons.vpn_key_rounded, size: 18), SizedBox(width: 8), Text('API Keys')]),
                  ),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.person_add_rounded, color: Color(0xFFC5A052)),
                onPressed: () => _showInviteDialog(context, ref, businessProfileId),
                tooltip: 'Invitar miembro',
              ),
            ],
          ),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(businessProfileProvider.notifier).load();
          if (businessProfileId != null) {
            await ref.read(teamProvider.notifier).load(businessProfileId);
          }
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _buildCurrentOwnerCard(businessProfile),
            const SizedBox(height: 16),
            if (teamState.members.isNotEmpty) ...[
              const Text(
                'Miembros del equipo',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15)),
              ),
              const SizedBox(height: 12),
              ...teamState.members.map((m) => _buildMemberTile(context, ref, businessProfileId, m)),
            ] else ...[
              _buildEmptyState(context, ref, businessProfileId),
            ],
            if (teamState.invitations.isNotEmpty) ...[
              const SizedBox(height: 24),
              const Text(
                'Invitaciones pendientes',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15)),
              ),
              const SizedBox(height: 12),
              ...teamState.invitations.map((inv) => _buildInvitationTile(context, ref, businessProfileId, inv)),
            ],
            if (teamState.isLoading) const Center(child: CircularProgressIndicator()),
            if (teamState.error != null)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text('Error: ${teamState.error}', style: const TextStyle(color: Colors.red)),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildCurrentOwnerCard(SaasBusinessProfile profile) {
    return Card(
      color: const Color(0xFFFAF6EE),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            CircleAvatar(radius: 28, backgroundColor: const Color(0xFFF59E0B), child: const Icon(Icons.person, color: Colors.white, size: 28)),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(profile.name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15))),
                  const SizedBox(height: 4),
                  Text('Propietario · ${profile.currentPlan.label}', style: const TextStyle(fontSize: 13, color: Color(0xFF8C7E74))),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: const Color(0xFFF59E0B), borderRadius: BorderRadius.circular(20)),
              child: const Text('OWNER', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context, WidgetRef ref, String? businessProfileId) {
    return Card(
      color: const Color(0xFFFAF6EE),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          children: [
            const Icon(Icons.group_outlined, size: 48, color: Color(0xFFC5A052)),
            const SizedBox(height: 12),
            const Text('Aún no tienes equipo', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15))),
            const SizedBox(height: 8),
            const Text('Invita a tus colaboradores para que gestionen el salón contigo.', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: Color(0xFF8C7E74))),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () => _showInviteDialog(context, ref, businessProfileId),
              icon: const Icon(Icons.person_add_rounded),
              label: const Text('Invitar primer miembro'),
              style: FilledButton.styleFrom(backgroundColor: const Color(0xFFC5A052), foregroundColor: const Color(0xFF1F1A15)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMemberTile(BuildContext context, WidgetRef ref, String? businessProfileId, TeamMember member) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: CircleAvatar(backgroundColor: member.role.color.withValues(alpha: 0.1), child: Icon(Icons.person, color: member.role.color)),
        title: Text(member.fullName.isNotEmpty ? member.fullName : member.email, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(member.email, style: const TextStyle(fontSize: 12, color: Color(0xFF8C7E74))),
        trailing: PopupMenuButton<String>(
          onSelected: (value) async {
            switch (value) {
              case 'change_role':
                _showChangeRoleDialog(context, ref, businessProfileId, member);
                break;
              case 'resend':
                if (member.id.isNotEmpty && businessProfileId != null) {
                  await ref.read(teamProvider.notifier).resendInvitation(businessProfileId, member.id);
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Invitación reenviada')));
                }
                break;
              case 'remove':
                if (member.id.isNotEmpty && businessProfileId != null) {
                  final confirm = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
                    title: const Text('Remover miembro'),
                    content: Text('¿Eliminar a ${member.fullName.isNotEmpty ? member.fullName : member.email} del equipo?'),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
                      FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Eliminar')),
                    ],
                  ));
                  if (confirm == true) {
                    await ref.read(teamProvider.notifier).remove(businessProfileId, member.id);
                    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Miembro eliminado')));
                  }
                }
                break;
            }
          },
          itemBuilder: (ctx) => [
            const PopupMenuItem(value: 'change_role', child: Row(children: [Icon(Icons.badge_outlined, size: 18), SizedBox(width: 8), Text('Cambiar rol')])),
            const PopupMenuItem(value: 'resend', child: Row(children: [Icon(Icons.send_rounded, size: 18), SizedBox(width: 8), Text('Reenviar invitación')])),
            const PopupMenuItem(value: 'remove', child: Row(children: [Icon(Icons.delete_outline, size: 18, color: Colors.red), SizedBox(width: 8), Text('Eliminar', style: TextStyle(color: Colors.red))])),
          ],
        ),
      ),
    );
  }

  Widget _buildInvitationTile(BuildContext context, WidgetRef ref, String? businessProfileId, TeamInvitation invitation) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: const Color(0xFFFFF8E1),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: CircleAvatar(backgroundColor: Colors.amber.withValues(alpha: 0.2), child: Icon(Icons.pending, color: Colors.amber, size: 20)),
        title: Text(invitation.email, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text('Rol: ${invitation.role.label} · ${invitation.status.label}', style: const TextStyle(fontSize: 12, color: Color(0xFF8C7E74))),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const Icon(Icons.send_rounded, color: Color(0xFFC5A052), size: 20),
              onPressed: () async {
                if (businessProfileId != null) {
                  await ref.read(teamProvider.notifier).resendInvitation(businessProfileId, invitation.id);
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Invitación reenviada')));
                }
              },
              tooltip: 'Reenviar',
            ),
            IconButton(
              icon: const Icon(Icons.cancel_rounded, color: Colors.red, size: 20),
              onPressed: () async {
                if (businessProfileId != null) {
                  await ref.read(teamProvider.notifier).remove(businessProfileId, invitation.id);
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Invitación cancelada')));
                }
              },
              tooltip: 'Cancelar',
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showInviteDialog(BuildContext context, WidgetRef ref, String? businessProfileId) async {
    if (businessProfileId == null) return;
    final emailCtrl = TextEditingController();
    MembershipRole selectedRole = MembershipRole.staff;
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Invitar miembro'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: emailCtrl, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email', hintText: 'colaborador@email.com', prefixIcon: Icon(Icons.email_outlined))),
            const SizedBox(height: 16),
            DropdownButtonFormField<MembershipRole>(
              initialValue: selectedRole,
              decoration: const InputDecoration(labelText: 'Rol', prefixIcon: Icon(Icons.badge_outlined)),
              items: [MembershipRole.admin, MembershipRole.manager, MembershipRole.staff].map((r) => DropdownMenuItem(value: r, child: Text(r.label))).toList(),
              onChanged: (v) => selectedRole = v ?? MembershipRole.staff,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () async {
              final email = emailCtrl.text.trim();
              if (email.isNotEmpty && email.contains('@')) {
                Navigator.pop(ctx);
                try {
                  await ref.read(teamProvider.notifier).invite(businessProfileId, InviteMemberRequest(email: email, role: selectedRole));
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Invitación enviada')));
                } catch (e) {
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
                }
              }
            },
            child: const Text('Invitar'),
          ),
        ],
      ),
    );
  }

  Future<void> _showChangeRoleDialog(BuildContext context, WidgetRef ref, String? businessProfileId, TeamMember member) async {
    if (businessProfileId == null) return;
    MembershipRole selectedRole = member.role;
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Cambiar rol de ${member.fullName.isNotEmpty ? member.fullName : member.email}'),
        content: DropdownButtonFormField<MembershipRole>(
          initialValue: selectedRole,
          decoration: const InputDecoration(labelText: 'Nuevo rol', prefixIcon: Icon(Icons.badge_outlined)),
          items: [MembershipRole.admin, MembershipRole.manager, MembershipRole.staff].map((r) => DropdownMenuItem(value: r, child: Text(r.label))).toList(),
          onChanged: (v) => selectedRole = v ?? MembershipRole.staff,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () async {
              Navigator.pop(ctx);
              if (selectedRole != member.role && member.id.isNotEmpty) {
                await ref.read(teamProvider.notifier).updateRole(businessProfileId, member.id, selectedRole);
                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Rol actualizado')));
              }
            },
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
  }
}
