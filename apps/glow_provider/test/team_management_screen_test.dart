import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_provider/screens/saas/team_management_screen.dart';

void main() {
  testWidgets(
    'Given an invitation accepted elsewhere, when resend returns 404, '
    'then reloads the team and shows a human-readable message',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final businessProfileNotifier = _LoadedBusinessProfileNotifier();
      final teamNotifier = _TeamNotifierWithStaleInvitation();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            businessProfileProvider
                .overrideWith((ref) => businessProfileNotifier),
            teamProvider.overrideWith((ref) => teamNotifier),
          ],
          child: const MaterialApp(home: TeamManagementScreen()),
        ),
      );
      await tester.pump();

      expect(find.text('Invitaciones pendientes'), findsOneWidget);
      expect(find.text('sonia@example.com'), findsOneWidget);

      await tester.tap(
        find.byKey(const Key('team-resend-invitation-invitation-1')),
      );
      await tester.pumpAndSettle();

      expect(teamNotifier.resendCalls, 1);
      expect(teamNotifier.reloadCalls, 1);
      expect(find.text('Sonia Herrera'), findsOneWidget);
      expect(find.text('Invitaciones pendientes'), findsNothing);
      expect(
        find.text(
          'La invitación ya no está pendiente. Actualizamos el equipo; revisa si la persona ya se unió.',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('Exception:'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}

class _LoadedBusinessProfileNotifier extends BusinessProfileNotifier {
  _LoadedBusinessProfileNotifier() {
    final now = DateTime(2026, 11, 25);
    state = BusinessProfileState(
      profile: SaasBusinessProfile(
        id: 'profile-1',
        ownerId: 'owner-1',
        name: 'QA Salón',
        slug: 'qa-salon',
        timezone: 'America/Bogota',
        currency: 'COP',
        currentPlan: SaasPlanTier.freeTrial,
        createdAt: now,
        updatedAt: now,
        isActive: true,
      ),
    );
  }

  @override
  Future<void> load() async {}
}

class _TeamNotifierWithStaleInvitation extends TeamNotifier {
  _TeamNotifierWithStaleInvitation() {
    final now = DateTime(2026, 11, 25);
    state = TeamState(
      members: const [
        TeamMember(
          id: 'owner-membership',
          userId: 'owner-1',
          email: 'owner@example.com',
          fullName: 'Dueño QA',
          role: MembershipRole.owner,
          invitationStatus: InvitationStatus.accepted,
          isOwner: true,
        ),
      ],
      invitations: [
        TeamInvitation(
          id: 'invitation-1',
          businessProfileId: 'profile-1',
          email: 'sonia@example.com',
          role: MembershipRole.staff,
          invitedByUserId: 'owner-1',
          status: InvitationStatus.pending,
          expiresAt: now.add(const Duration(days: 7)),
          createdAt: now,
        ),
      ],
    );
  }

  int resendCalls = 0;
  int reloadCalls = 0;

  @override
  Future<bool> resendInvitation(
      String businessProfileId, String invitationId) async {
    resendCalls++;
    final error = Exception('404 Invitación pendiente no encontrada');
    state = state.copyWith(isLoading: false, error: error);
    throw error;
  }

  @override
  Future<void> load(String businessProfileId) async {
    reloadCalls++;
    state = const TeamState(
      members: [
        TeamMember(
          id: 'owner-membership',
          userId: 'owner-1',
          email: 'owner@example.com',
          fullName: 'Dueño QA',
          role: MembershipRole.owner,
          invitationStatus: InvitationStatus.accepted,
          isOwner: true,
        ),
        TeamMember(
          id: 'sonia-membership',
          userId: 'sonia-1',
          email: 'sonia@example.com',
          fullName: 'Sonia Herrera',
          role: MembershipRole.staff,
          invitationStatus: InvitationStatus.accepted,
          isOwner: false,
        ),
      ],
    );
  }
}
